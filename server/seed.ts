import { DateTime } from 'luxon';
import type { State, User } from '../shared/types.js';
import { createBooking, audit, system } from './domain.js';
import { demoAccounts } from '../shared/demo-accounts.js';
import { seedDemoCredentials } from './passwords.js';

export function seed(s: State, demo: boolean, secret: string, now = new Date()) {
  if (!s.settings.length)
    s.settings.push({
      id: 'restaurant',
      name: 'Lopez',
      timezone: 'Asia/Kolkata',
      durationMinutes: 90,
      slotMinutes: 15,
      depositPaise: 50000,
      horizonDays: 30,
      graceMinutes: 15,
      hours: Array.from({ length: 7 }, (_, day) => ({
        day,
        open: '11:00',
        close: '23:00',
        closed: false,
      })),
      closedDates: [],
    });
  if (!s.tables.length)
    s.tables.push(
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `table-${i + 1}`,
        number: String(i + 1).padStart(2, '0'),
        capacity: [2, 2, 4, 4, 2, 4, 4, 6, 2, 4, 6, 8][i],
        area: i < 8 ? 'Main dining' : 'Garden terrace',
        active: true,
        order: i,
      })),
    );
  if (!demo) return;
  if (s.users.length) {
    seedDemoCredentials(s);
    return;
  }
  s.users.push(
    {
      id: 'demo-admin',
      name: 'Alex Morgan',
      email: demoAccounts.ADMIN.email,
      role: 'ADMIN',
      active: true,
    },
    {
      id: 'demo-staff',
      name: 'Jamie Parker',
      email: demoAccounts.STAFF.email,
      role: 'STAFF',
      active: true,
    },
    {
      id: 'demo-customer',
      name: 'Sam Rivera',
      email: demoAccounts.CUSTOMER.email,
      role: 'CUSTOMER',
      active: true,
    },
  );
  seedDemoCredentials(s);
  const local = DateTime.fromJSDate(now).setZone(s.settings[0].timezone);
  const base =
    local.hour >= 11 && local.hour < 21
      ? local.set({ minute: Math.floor(local.minute / 15) * 15, second: 0, millisecond: 0 })
      : local
          .set({ hour: 12, minute: 0, second: 0, millisecond: 0 })
          .plus({ days: local.hour >= 21 ? 1 : 0 });
  ['Olivia Chen', 'Marcus Williams', 'Sofia Patel', 'James Wilson', 'Emma Thompson'].forEach(
    (name, i) => {
      const customer: User = {
        id: `sample-${i}`,
        name,
        email: `guest${i}@example.com`,
        role: 'CUSTOMER',
        active: true,
      };
      const time = base.plus({ minutes: i < 2 ? -30 : (i - 1) * 30 });
      if (time.hour < 11) return;
      const b = createBooking(
        s,
        customer,
        {
          tableId: `table-${[3, 7, 4, 10, 12][i]}`,
          partySize: [3, 4, 2, 3, 6][i],
          start: time.toUTC().toISO()!,
        },
        secret,
        false,
        time.minus({ minutes: 15 }).toJSDate(),
      );
      b.status = i < 2 && time.toMillis() <= +now ? 'CHECKED_IN' : 'CONFIRMED';
      if (b.status === 'CHECKED_IN') b.checkedInAt = b.start;
      const p = s.payments.find((p) => p.bookingId === b.id)!;
      p.status = 'CAPTURED';
      p.orderId = `demo_order_${i}`;
      p.paymentId = `demo_payment_${i}`;
    },
  );
  audit(s, system, 'RESTAURANT_READY', 'Lopez', 'Demo tables and sample reservations loaded', now);
}
