import mongoose, { Schema, type Model } from 'mongoose';
import type { State } from '../shared/types.js';

export const emptyState = (): State => ({
  users: [],
  tables: [],
  settings: [],
  bookings: [],
  locks: [],
  payments: [],
  audits: [],
  notifications: [],
  invites: [],
  events: [],
  credentials: [],
});
export interface Store {
  readonly kind: 'memory' | 'mongodb';
  read(): Promise<State>;
  transaction<T>(fn: (state: State) => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// Demo and unit tests have the same atomic transaction semantics as the database adapter.
export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private state: State;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(initial: State = emptyState()) {
    this.state = structuredClone(initial);
  }
  async read() {
    await this.tail;
    return structuredClone(this.state);
  }
  transaction<T>(fn: (state: State) => T | Promise<T>): Promise<T> {
    const job = this.tail.then(async () => {
      const next = structuredClone(this.state);
      const result = await fn(next);
      this.state = next;
      return structuredClone(result);
    });
    this.tail = job.catch(() => undefined);
    return job;
  }
  async close() {}
}

type Row = { id: string; [key: string]: unknown };
const keys = Object.keys(emptyState()) as (keyof State)[];
export class MongoStore implements Store {
  readonly kind = 'mongodb' as const;
  private models = {} as Record<keyof State, Model<Row>>;
  private gate = mongoose.model('RestaurantGate', new Schema({ _id: String, revision: Number }));
  async connect(uri: string) {
    await mongoose.connect(uri);
    for (const key of keys) {
      const schema = new Schema<Row>(
        { id: { type: String, required: true, unique: true } },
        { strict: false, versionKey: false },
      );
      if (key === 'locks') schema.index({ tableId: 1, slot: 1 }, { unique: true });
      if (key === 'tables') schema.index({ number: 1 }, { unique: true });
      if (key === 'users') schema.index({ email: 1 }, { unique: true });
      if (key === 'credentials') schema.index({ userId: 1 }, { unique: true });
      if (key === 'bookings') schema.index({ code: 1 }, { unique: true });
      if (key === 'payments') schema.index({ orderId: 1 }, { unique: true, sparse: true });
      this.models[key] = mongoose.model<Row>(`Lopez_${key}`, schema);
      await this.models[key].init();
    }
    await this.gate.updateOne(
      { _id: 'restaurant' },
      { $setOnInsert: { revision: 0 } },
      { upsert: true },
    );
    // Fail early on a standalone MongoDB: transactions require a replica set (Atlas works).
    await this.transaction(() => undefined);
    return this;
  }
  private async snapshot(session?: mongoose.ClientSession): Promise<State> {
    const state = emptyState();
    // Mongoose sessions do not support parallel operations within a transaction.
    for (const key of keys) {
      const rows = await this.models[key]
        .find({}, { _id: 0 })
        .session(session ?? null)
        .lean();
      (state[key] as unknown) = rows;
    }
    return state;
  }
  async read() {
    const session = await mongoose.startSession();
    try {
      let state!: State;
      await session.withTransaction(
        async () => {
          state = await this.snapshot(session);
        },
        { readConcern: { level: 'snapshot' } },
      );
      return state;
    } finally {
      await session.endSession();
    }
  }
  async transaction<T>(fn: (state: State) => T | Promise<T>): Promise<T> {
    const session = await mongoose.startSession();
    let result!: T;
    try {
      await session.withTransaction(
        async () => {
          // A per-restaurant write gate makes interval checks, role changes, holds and
          // webhook decisions serializable across API processes. Unique slot indexes
          // provide a second database invariant. External I/O must stay outside fn.
          await this.gate.updateOne({ _id: 'restaurant' }, { $inc: { revision: 1 } }, { session });
          const before = await this.snapshot(session);
          const next = structuredClone(before);
          result = await fn(next);
          for (const key of keys) {
            const old = new Map(before[key].map((row) => [row.id, JSON.stringify(row)]));
            const rows = next[key] as unknown as Row[];
            const ids = new Set(rows.map((row) => row.id));
            const deleted = [...old.keys()].filter((id) => !ids.has(id));
            if (deleted.length)
              await this.models[key].deleteMany({ id: { $in: deleted } }, { session });
            for (const row of rows)
              if (old.get(row.id) !== JSON.stringify(row)) {
                await this.models[key].replaceOne({ id: row.id }, row, { upsert: true, session });
              }
          }
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
      return result;
    } finally {
      await session.endSession();
    }
  }
  async close() {
    await mongoose.disconnect();
  }
}
