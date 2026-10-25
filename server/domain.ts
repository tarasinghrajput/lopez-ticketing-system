import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type {
  Audit,
  Booking,
  BookingView,
  Settings,
  State,
  Table,
  TableView,
  User,
} from '../shared/types.js';

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new AppError(status, message);
}
export const id = () => randomUUID();
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const ticket = (booking: Pick<Booking, 'id' | 'createdAt'>, secret: string) =>
  `${booking.id}.${createHmac('sha256', secret).update(`${booking.id}:${booking.createdAt}`).digest('base64url')}`;
export const minutes = (n: number) => n * 60_000;
export const activeStatuses = ['PAYMENT_PENDING', 'CONFIRMED', 'CHECKED_IN'];
export function audit(
  s: State,
  actor: Pick<User, 'id' | 'name'>,
  action: string,
  target: string,
  detail = '',
  now = new Date(),
) {
  const entry: Audit = {
    id: id(),
    actorId: actor.id,
    actorName: actor.name,
    action,
    target,
    detail,
    at: now.toISOString(),
  };
  s.audits.push(entry);
}
export const system = { id: 'system', name: 'System' };
export function notify(s: State, b: Booking, subject: string, body: string, now = new Date()) {
  s.notifications.push({
    id: id(),
    userId: b.userId,
    email: b.email,
    subject,
    body: `${body}\nBooking ${b.code} · Table ${b.tableNumber}\n${DateTime.fromISO(b.start).setZone(s.settings[0].timezone).toFormat('dd LLL yyyy, h:mm a')}\nView your reservation in My bookings.`,
    at: now.toISOString(),
    sent: false,
    attempts: 0,
  });
}
export function expireHolds(s: State, now = new Date()) {
  for (const b of s.bookings)
    if (b.status === 'PAYMENT_PENDING' && Date.parse(b.holdUntil!) <= +now) {
      b.status = 'EXPIRED';
      s.locks = s.locks.filter((l) => l.bookingId !== b.id);
      audit(s, system, 'HOLD_EXPIRED', b.code, 'Checkout hold released', now);
    }
}
export function lockSlots(start: string, end: string) {
  // Minute granularity supports arbitrary walk-in times without rounding away overlaps.
  const values: string[] = [];
  for (let t = Math.floor(Date.parse(start) / 60_000) * 60_000; t < Date.parse(end); t += 60_000)
    values.push(new Date(t).toISOString());
  return values;
}
export function isFree(s: State, tableId: string, start: string, end: string, now = new Date()) {
  return !s.bookings.some(
    (b) =>
      b.tableId === tableId &&
      activeStatuses.includes(b.status) &&
      !(b.status === 'PAYMENT_PENDING' && Date.parse(b.holdUntil!) <= +now) &&
      ((Date.parse(b.start) < Date.parse(end) && Date.parse(b.end) > Date.parse(start)) ||
        (b.status === 'CHECKED_IN' && Date.parse(b.end) <= +now && Date.parse(start) <= +now)),
  );
}
export function validateWindow(settings: Settings, start: string, now: Date, walkIn = false) {
  const dt = DateTime.fromISO(start, { zone: 'utc' }).setZone(settings.timezone);
  assert(dt.isValid, 400, 'Choose a valid date and time.');
  const today = DateTime.fromJSDate(now).setZone(settings.timezone);
  assert(dt.toMillis() >= +now - (walkIn ? 60_000 : 0), 400, 'The selected time is in the past.');
  assert(
    dt.startOf('day') <= today.startOf('day').plus({ days: settings.horizonDays }),
    400,
    'That date is outside the booking window.',
  );
  const hours = settings.hours.find((h) => h.day === dt.weekday % 7);
  assert(
    hours && !hours.closed && !settings.closedDates.includes(dt.toISODate()!),
    400,
    'The restaurant is closed on this date.',
  );
  const [oh, om] = hours.open.split(':').map(Number),
    [ch, cm] = hours.close.split(':').map(Number);
  const open = dt.startOf('day').set({ hour: oh, minute: om });
  const close = dt.startOf('day').set({ hour: ch, minute: cm });
  const end = dt.plus({ minutes: settings.durationMinutes });
  assert(dt >= open && end <= close, 400, 'The full visit must fit within opening hours.');
  assert(
    walkIn || (dt.minute + dt.hour * 60 - oh * 60 - om) % settings.slotMinutes === 0,
    400,
    'Choose a listed start time.',
  );
  assert(walkIn || (dt.second === 0 && dt.millisecond === 0), 400, 'Choose a listed start time.');
  return end.toUTC().toISO()!;
}
export function slotsForDate(settings: Settings, date: string, now = new Date()) {
  const dt = DateTime.fromISO(date, { zone: settings.timezone });
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date) && dt.isValid, 400, 'Choose a valid date.');
  const h = settings.hours.find((h) => h.day === dt.weekday % 7);
  if (!h || h.closed || settings.closedDates.includes(date)) return [];
  const [hour, minute] = h.open.split(':').map(Number);
  const result: string[] = [];
  for (
    let time = dt.set({ hour, minute });
    time < dt.endOf('day');
    time = time.plus({ minutes: settings.slotMinutes })
  ) {
    try {
      validateWindow(settings, time.toUTC().toISO()!, now);
      result.push(time.toUTC().toISO()!);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
    }
  }
  return result;
}
export function createBooking(
  s: State,
  actor: User,
  input: {
    tableId: string;
    partySize: number;
    start: string;
    guestName?: string;
    email?: string;
    phone?: string;
    notes?: string;
  },
  secret: string,
  walkIn = false,
  now = new Date(),
) {
  expireHolds(s, now);
  const table = s.tables.find((t) => t.id === input.tableId && t.active);
  assert(table, 404, 'This table is unavailable.');
  assert(
    input.partySize > 0 && input.partySize <= table.capacity,
    400,
    'The party is larger than this table.',
  );
  if (!walkIn)
    assert(
      !s.bookings.some((b) => b.userId === actor.id && b.status === 'PAYMENT_PENDING'),
      409,
      'Finish or cancel your existing checkout first.',
    );
  const start = new Date(input.start).toISOString();
  const end = validateWindow(s.settings[0], start, now, walkIn);
  assert(
    isFree(s, table.id, start, end, now),
    409,
    'Someone just reserved this table. Please choose another.',
  );
  const b: Booking = {
    id: id(),
    code: `LP-${randomBytes(4).toString('hex').toUpperCase()}`,
    userId: walkIn ? undefined : actor.id,
    guestName: walkIn ? input.guestName! : actor.name,
    email: walkIn ? input.email : actor.email,
    phone: input.phone,
    tableId: table.id,
    tableNumber: table.number,
    partySize: input.partySize,
    start,
    end,
    status: walkIn ? 'CHECKED_IN' : 'PAYMENT_PENDING',
    source: walkIn ? 'WALK_IN' : 'ONLINE',
    holdUntil: walkIn ? undefined : new Date(+now + minutes(10)).toISOString(),
    depositPaise: walkIn ? 0 : s.settings[0].depositPaise,
    createdAt: now.toISOString(),
    checkedInAt: walkIn ? now.toISOString() : undefined,
    ticketHash: '',
    notes: input.notes ?? '',
  };
  b.ticketHash = hash(ticket(b, secret));
  for (const slot of lockSlots(start, end)) {
    assert(
      !s.locks.some((l) => l.tableId === table.id && l.slot === slot),
      409,
      'This time is no longer available.',
    );
    s.locks.push({ id: `${table.id}:${slot}`, tableId: table.id, slot, bookingId: b.id });
  }
  s.bookings.push(b);
  if (!walkIn)
    s.payments.push({
      id: id(),
      bookingId: b.id,
      amount: b.depositPaise,
      status: 'CREATING',
      refundStatus: 'NONE',
    });
  audit(
    s,
    actor,
    walkIn ? 'WALK_IN_SEATED' : 'HOLD_CREATED',
    b.code,
    `Table ${b.tableNumber} · ${b.partySize} guests`,
    now,
  );
  if (walkIn) notify(s, b, 'Welcome to Lopez', 'Your table is ready. Enjoy your visit!', now);
  return b;
}
export function viewBooking(s: State, b: Booking, secret: string): BookingView {
  const { ticketHash: _hash, ...safe } = b;
  return {
    ...safe,
    ticketHash: '',
    payment: s.payments.find((p) => p.bookingId === b.id),
    ticketToken: ['CONFIRMED', 'CHECKED_IN'].includes(b.status) ? ticket(b, secret) : undefined,
  };
}
export function tableView(s: State, table: Table, at: Date): TableView {
  const zone = s.settings[0].timezone;
  const selectedDate = DateTime.fromJSDate(at).setZone(zone).toISODate();
  const viewingToday = selectedDate === DateTime.now().setZone(zone).toISODate();
  const bookings = s.bookings
    .filter(
      (b) =>
        b.tableId === table.id &&
        activeStatuses.includes(b.status) &&
        !(b.status === 'PAYMENT_PENDING' && Date.parse(b.holdUntil!) <= Date.now()) &&
        (DateTime.fromISO(b.start).setZone(zone).toISODate() === selectedDate ||
          (viewingToday && b.status === 'CHECKED_IN' && Date.parse(b.start) <= +at)),
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  const current =
    bookings.find(
      (b) => b.status === 'CHECKED_IN' && Date.parse(b.checkedInAt ?? b.start) <= +at,
    ) ?? bookings.find((b) => Date.parse(b.start) <= +at && Date.parse(b.end) > +at);
  const upcoming = bookings.find((b) => b.id !== current?.id && Date.parse(b.start) > +at);
  let state: TableView['state'] = table.active ? 'available' : 'unavailable';
  if (current)
    state =
      current.status === 'CHECKED_IN'
        ? Date.parse(current.end) <= +at
          ? 'overdue'
          : 'occupied'
        : current.status === 'PAYMENT_PENDING'
          ? 'held'
          : 'reserved';
  return { ...table, state, current, upcoming };
}
