import { beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { MemoryStore, emptyState } from '../server/store.js';
import { BookingService } from '../server/service.js';
import { DemoGateway, validSignature } from '../server/gateway.js';
import {
  AppError,
  createBooking,
  expireHolds,
  hash,
  slotsForDate,
  tableView,
  ticket,
  validateWindow,
} from '../server/domain.js';
import { seed } from '../server/seed.js';
import { settingsInput } from '../server/validation.js';
import type { User } from '../shared/types.js';

const now = new Date('2026-10-25T06:00:00.000Z'); // 11:30 India
const start = '2026-10-25T07:00:00.000Z';
const secret = 'test-ticket-secret';
const guest: User = {
  id: 'guest-1',
  name: 'Test Guest',
  email: 'guest@example.com',
  role: 'CUSTOMER',
  active: true,
};
const admin: User = {
  id: 'admin-1',
  name: 'Admin',
  email: 'admin@example.com',
  role: 'ADMIN',
  active: true,
};
const input = { tableId: 'table-1', partySize: 2, start };
let store: MemoryStore, service: BookingService;
beforeEach(async () => {
  store = new MemoryStore();
  await store.transaction((s) => {
    seed(s, false, secret, now);
    s.users.push(guest, admin);
  });
  service = new BookingService(store, new DemoGateway(), secret, true);
});
async function hold() {
  return service.hold(guest, input, now);
}
async function capture(b: Awaited<ReturnType<typeof hold>>, at = now, eventId = 'evt-1') {
  return service.captured(
    eventId,
    { id: 'pay-1', order_id: b.payment!.orderId!, amount: b.depositPaise, currency: 'INR' },
    at,
  );
}

describe('Booking invariants', () => {
  it('allows exactly one of two simultaneous overlapping holds', async () => {
    const results = await Promise.allSettled([
      service.hold(guest, input, now),
      service.hold({ ...guest, id: 'other' }, input, now),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await store.read()).locks).toHaveLength(90);
  });
  it('allows adjacent visits, but rejects partial overlaps', async () => {
    await hold();
    await expect(
      service.hold(
        { ...guest, id: 'second' },
        { ...input, start: '2026-10-25T07:30:00.000Z' },
        now,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.hold({ ...guest, id: 'third' }, { ...input, start: '2026-10-25T08:30:00.000Z' }, now),
    ).resolves.toMatchObject({ status: 'PAYMENT_PENDING' });
  });
  it('rejects excess party size', async () => {
    await expect(service.hold(guest, { ...input, partySize: 3 }, now)).rejects.toMatchObject({
      status: 400,
    });
  });
  it('rejects past, out-of-hours, off-grid, and out-of-horizon windows', async () => {
    for (const start of [
      '2026-10-25T05:00:00.000Z',
      '2026-10-25T17:00:00.000Z',
      '2026-10-25T07:07:00.000Z',
      '2027-01-01T07:00:00.000Z',
    ])
      await expect(service.hold(guest, { ...input, start }, now)).rejects.toMatchObject({
        status: 400,
      });
  });
  it('limits each customer to one pending checkout', async () => {
    await hold();
    await expect(service.hold(guest, { ...input, tableId: 'table-2' }, now)).rejects.toMatchObject({
      status: 409,
    });
  });
  it('expires abandoned holds and releases slots on the next booking attempt', async () => {
    const b = await hold();
    const later = new Date(+now + 11 * 60000);
    await expect(service.hold({ ...guest, id: 'next' }, input, later)).resolves.toMatchObject({
      status: 'PAYMENT_PENDING',
    });
    expect((await service.get(b.id, guest)).status).toBe('EXPIRED');
    expect((await store.read()).locks).toHaveLength(90);
  });
  it('cancellation releases the table, preserving history and audit', async () => {
    const b = await hold();
    await service.action(b.id, guest, 'cancel', now);
    expect((await store.read()).locks).toHaveLength(0);
    expect((await store.read()).audits.some((a) => a.action === 'CANCEL')).toBe(true);
  });
  it('rolls back an entire failed transaction', async () => {
    await expect(
      store.transaction((s) => {
        s.tables[0].capacity = 99;
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await store.read()).tables[0].capacity).toBe(2);
  });
  it('does not expose another customer’s reservation', async () => {
    const b = await hold();
    await expect(service.get(b.id, { ...guest, id: 'intruder' })).rejects.toMatchObject({
      status: 404,
    });
  });
});
describe('Verified payment lifecycle', () => {
  it('creates a ticket only after verified capture', async () => {
    const b = await hold();
    expect(b.ticketToken).toBeUndefined();
    await capture(b);
    const confirmed = await service.get(b.id, guest);
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.ticketToken).toBeTruthy();
    expect(confirmed.ticketHash).toBe('');
  });
  it('handles duplicate capture events without duplicate notifications', async () => {
    const b = await hold();
    await capture(b);
    await capture(b);
    await capture(b, now, 'evt-2');
    const s = await store.read();
    expect(s.notifications).toHaveLength(1);
    expect(s.events).toHaveLength(2);
  });
  it('refuses mismatched amount and currency', async () => {
    const b = await hold();
    await expect(
      service.captured(
        'bad',
        { id: 'p', order_id: b.payment!.orderId!, amount: 1, currency: 'USD' },
        now,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect((await service.get(b.id, guest)).status).toBe('PAYMENT_PENDING');
  });
  it('queues full refund after hold expiry without resurrecting a booking', async () => {
    const b = await hold();
    await capture(b, new Date(+now + 11 * 60000));
    const expired = await service.get(b.id, guest);
    expect(expired.status).toBe('EXPIRED');
    expect(expired.payment?.refundStatus).toBe('APPROVED');
    expect((await store.read()).locks).toHaveLength(0);
    await service.processRefunds();
    expect((await service.get(b.id, guest)).payment?.refundStatus).toBe('REFUNDED');
  });
  it('queues a late capture refund after cancellation', async () => {
    const b = await hold();
    await service.action(b.id, guest, 'cancel', now);
    await capture(b);
    expect((await service.get(b.id, guest)).payment?.refundStatus).toBe('APPROVED');
  });
  it('requires an admin decision for ordinary customer cancellations', async () => {
    const b = await hold();
    await capture(b);
    await service.action(b.id, guest, 'cancel', now);
    expect((await service.get(b.id, guest)).payment?.refundStatus).toBe('REVIEW');
    await service.processRefunds();
    expect((await service.get(b.id, guest)).payment?.refundStatus).toBe('REVIEW');
    await service.refundDecision(b.payment!.id, admin, true, 'Cancelled in advance');
    await service.processRefunds();
    expect((await service.get(b.id, guest)).payment?.refundStatus).toBe('REFUNDED');
  });
  it('rejects a second decision and preserves refund success on a later failure event', async () => {
    const b = await hold();
    await capture(b);
    await service.action(b.id, guest, 'cancel', now);
    await service.refundDecision(b.payment!.id, admin, true, 'Approved');
    await expect(
      service.refundDecision(b.payment!.id, admin, false, 'Declined'),
    ).rejects.toMatchObject({ status: 409 });
    await service.refunded('r1', {
      id: 'ref-1',
      status: 'processed',
      amount: b.depositPaise,
      payment_id: 'pay-1',
    });
    await service.refunded(
      'r2',
      { id: 'ref-1', status: 'failed', amount: b.depositPaise, payment_id: 'pay-1' },
      true,
    );
    expect((await service.get(b.id, guest)).payment?.refundStatus).toBe('REFUNDED');
  });
  it('does not resubmit an uncertain refund response', async () => {
    const b = await hold();
    await capture(b);
    await service.action(b.id, guest, 'cancel', now);
    await service.refundDecision(b.payment!.id, admin, true, 'Approved');
    let calls = 0;
    service.gateway.refund = async () => {
      calls++;
      throw new Error('Timeout');
    };
    await service.processRefunds();
    await service.processRefunds();
    expect(calls).toBe(1);
    expect((await service.get(b.id, guest)).payment?.refundStatus).toBe('SUBMITTING');
  });
  it('verifies raw webhook payload with timing-safe HMAC comparison', () => {
    const body = Buffer.from('{"a":1}'),
      key = 'webhook-secret';
    const signature = createHmac('sha256', key).update(body).digest('hex');
    expect(validSignature(body, signature, key)).toBe(true);
    expect(validSignature(Buffer.from('{ "a":1}'), signature, key)).toBe(false);
    expect(validSignature(body, 'wrong', key)).toBe(false);
  });
});
describe('Restaurant operations', () => {
  it('staff can seat a paid booking, complete it, and free its table', async () => {
    const b = await hold();
    await capture(b);
    const arrival = new Date(start);
    const seated = await service.action(b.id, admin, 'check-in', arrival);
    expect(seated.status).toBe('CHECKED_IN');
    await expect(service.action(b.id, admin, 'check-in', arrival)).rejects.toMatchObject({
      status: 409,
    });
    await service.action(b.id, admin, 'complete', arrival);
    expect((await store.read()).locks).toHaveLength(0);
  });
  it('prevents customers from checking themselves in', async () => {
    const b = await hold();
    await capture(b);
    await expect(service.action(b.id, guest, 'check-in', new Date(start))).rejects.toMatchObject({
      status: 403,
    });
  });
  it('prevents early check-in and premature no-show', async () => {
    const b = await hold();
    await capture(b);
    await expect(service.action(b.id, admin, 'check-in', now)).rejects.toMatchObject({
      status: 409,
    });
    await expect(service.action(b.id, admin, 'no-show', new Date(start))).rejects.toMatchObject({
      status: 409,
    });
  });
  it('creates walk-ins without accounts or payment records', async () => {
    const b = await store.transaction((s) =>
      createBooking(
        s,
        admin,
        { ...input, start: now.toISOString(), guestName: 'Walk-in' },
        secret,
        true,
        now,
      ),
    );
    expect(b.status).toBe('CHECKED_IN');
    expect(b.userId).toBeUndefined();
    expect(b.depositPaise).toBe(0);
    expect((await store.read()).payments).toHaveLength(0);
  });
  it('prevents another party from seating at an overdue occupied table', async () => {
    const b = await hold();
    await capture(b);
    await service.action(b.id, admin, 'check-in', new Date(start));
    const later = new Date('2026-10-25T09:00:00.000Z');
    await expect(
      store.transaction((s) =>
        createBooking(
          s,
          admin,
          { ...input, start: later.toISOString(), guestName: 'Next' },
          secret,
          true,
          later,
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });
    const s = await store.read();
    expect(tableView(s, s.tables[0], later).state).toBe('overdue');
  });
  it('looks up both QR tokens and fallback booking codes, rejecting tampering', async () => {
    const b = await hold();
    await capture(b);
    const confirmed = await service.get(b.id, guest);
    expect((await service.lookup(confirmed.ticketToken!)).id).toBe(b.id);
    expect((await service.lookup(b.code.toLowerCase())).id).toBe(b.id);
    await expect(service.lookup(confirmed.ticketToken! + 'x')).rejects.toMatchObject({
      status: 404,
    });
  });
});
describe('Restaurant time and configuration', () => {
  it('uses restaurant timezone to calculate start and closing boundaries', async () => {
    const settings = (await store.read()).settings[0];
    const slots = slotsForDate(settings, '2026-10-26', now);
    expect(slots[0]).toBe('2026-10-26T05:30:00.000Z');
    expect(slots.at(-1)).toBe('2026-10-26T16:00:00.000Z');
  });
  it('respects holidays and closed weekdays', async () => {
    const s = (await store.read()).settings[0];
    s.closedDates = ['2026-10-26'];
    expect(slotsForDate(s, '2026-10-26', now)).toEqual([]);
    s.hours[0].closed = true;
    expect(slotsForDate(s, '2026-10-25', now)).toEqual([]);
  });
  it('computes UTC times correctly across daylight saving changes', async () => {
    const s = (await store.read()).settings[0];
    s.timezone = 'America/New_York';
    s.horizonDays = 90;
    expect(slotsForDate(s, '2026-10-31', now)[0]).toBe('2026-10-31T15:00:00.000Z');
    expect(slotsForDate(s, '2026-11-01', now)[0]).toBe('2026-11-01T16:00:00.000Z');
  });
  it('rejects missing weekdays and inverted opening hours', async () => {
    const s = (await store.read()).settings[0];
    s.hours[0].close = '10:00';
    expect(settingsInput.safeParse(s).success).toBe(false);
    s.hours[0].close = '23:00';
    s.hours[0].day = 1;
    expect(settingsInput.safeParse(s).success).toBe(false);
  });
});
