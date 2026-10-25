export type Role = 'CUSTOMER' | 'STAFF' | 'ADMIN';
export type BookingStatus =
  | 'PAYMENT_PENDING'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'EXPIRED';
export type RefundStatus =
  'NONE' | 'REVIEW' | 'APPROVED' | 'SUBMITTING' | 'PENDING' | 'REFUNDED' | 'REJECTED' | 'FAILED';
export interface User {
  id: string;
  googleId?: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
}
export interface Table {
  id: string;
  number: string;
  capacity: number;
  area: string;
  active: boolean;
  order: number;
}
export interface Settings {
  id: string;
  name: string;
  timezone: string;
  durationMinutes: number;
  slotMinutes: number;
  depositPaise: number;
  horizonDays: number;
  graceMinutes: number;
  hours: { day: number; open: string; close: string; closed: boolean }[];
  closedDates: string[];
}
export interface Booking {
  id: string;
  code: string;
  userId?: string;
  guestName: string;
  email?: string;
  phone?: string;
  tableId: string;
  tableNumber: string;
  partySize: number;
  start: string;
  end: string;
  status: BookingStatus;
  source: 'ONLINE' | 'WALK_IN';
  holdUntil?: string;
  depositPaise: number;
  createdAt: string;
  checkedInAt?: string;
  completedAt?: string;
  ticketHash: string;
  notes: string;
}
export interface SlotLock {
  id: string;
  tableId: string;
  slot: string;
  bookingId: string;
}
export interface Payment {
  id: string;
  bookingId: string;
  orderId?: string;
  paymentId?: string;
  amount: number;
  status: 'CREATING' | 'PENDING' | 'CAPTURED' | 'FAILED';
  refundStatus: RefundStatus;
  refundId?: string;
  refundReason?: string;
  refundAttemptAt?: string;
  error?: string;
}
export interface Audit {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  target: string;
  detail: string;
  at: string;
}
export interface Notification {
  id: string;
  userId?: string;
  email?: string;
  subject: string;
  body: string;
  at: string;
  sent: boolean;
  attempts: number;
  nextAttemptAt?: string;
}
export interface Invite {
  id: string;
  email: string;
  role: 'STAFF' | 'ADMIN';
}
export interface WebhookEvent {
  id: string;
  at: string;
}
export interface Credential {
  id: string;
  userId: string;
  salt: string;
  passwordHash: string;
}
export interface State {
  users: User[];
  tables: Table[];
  settings: Settings[];
  bookings: Booking[];
  locks: SlotLock[];
  payments: Payment[];
  audits: Audit[];
  notifications: Notification[];
  invites: Invite[];
  events: WebhookEvent[];
  credentials: Credential[];
}
export interface SessionResponse {
  user: User | null;
  csrf: string;
  mode: 'demo' | 'live';
  storage: 'memory' | 'mongodb';
  settings: Settings;
}
export interface BookingView extends Booking {
  payment?: Payment;
  ticketToken?: string;
}
export type TableState = 'available' | 'occupied' | 'reserved' | 'held' | 'overdue' | 'unavailable';
export interface TableView extends Table {
  state: TableState;
  current?: Booking;
  upcoming?: Booking;
}
export interface Dashboard {
  tables: TableView[];
  bookings: BookingView[];
  settings: Settings;
  serverTime: string;
}
