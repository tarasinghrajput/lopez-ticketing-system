import { afterAll, beforeAll, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoStore } from '../server/store.js';
import { seed } from '../server/seed.js';
import { BookingService } from '../server/service.js';
import { DemoGateway } from '../server/gateway.js';

let replica: MongoMemoryReplSet, store: MongoStore;
const now = new Date('2026-10-25T06:00:00.000Z');
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: '7.0.14' },
  });
  store = await new MongoStore().connect(replica.getUri());
  await store.transaction((s) => seed(s, false, 'test', now));
});
afterAll(async () => {
  if (store) await store.close();
  if (replica) await replica.stop();
});
it('enforces atomic holds through real MongoDB transactions and unique indexes', async () => {
  const service = new BookingService(store, new DemoGateway(), 'test', true);
  const guest = {
    id: 'one',
    name: 'Guest One',
    email: 'one@example.com',
    role: 'CUSTOMER' as const,
    active: true,
  };
  const input = { tableId: 'table-1', partySize: 2, start: '2026-10-25T07:00:00.000Z' };
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) => service.hold({ ...guest, id: `guest-${i}` }, input, now)),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const state = await store.read();
  expect(state.bookings).toHaveLength(1);
  expect(state.locks).toHaveLength(90);
  await expect(
    store.transaction((s) => {
      s.tables[0].capacity = 99;
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  expect((await store.read()).tables[0].capacity).toBe(2);
});
