import { DateTime } from 'luxon';
import type { Booking, Payment, State, User } from '../shared/types.js';
import type { Store } from './store.js';
import type { Gateway, RefundResult } from './gateway.js';
import {
  AppError,
  assert,
  audit,
  createBooking,
  expireHolds,
  hash,
  id,
  isFree,
  notify,
  system,
  viewBooking,
} from './domain.js';

export class BookingService {
  constructor(
    public store: Store,
    public gateway: Gateway,
    public secret: string,
    public demo: boolean,
  ) {}
  async hold(actor: User, input: Parameters<typeof createBooking>[2], now = new Date()) {
    const booking = await this.store.transaction((s) =>
      createBooking(s, actor, input, this.secret, false, now),
    );
    try {
      const order = await this.gateway.createOrder(booking.depositPaise, booking.code);
      await this.store.transaction((s) => {
        const p = s.payments.find((p) => p.bookingId === booking.id)!;
        p.orderId = order.id;
        p.status = 'PENDING';
      });
    } catch (e) {
      await this.store.transaction((s) => {
        const b = s.bookings.find((b) => b.id === booking.id)!;
        b.status = 'EXPIRED';
        s.locks = s.locks.filter((l) => l.bookingId !== b.id);
        s.payments.find((p) => p.bookingId === b.id)!.status = 'FAILED';
        audit(s, system, 'CHECKOUT_FAILED', b.code);
      });
      throw e;
    }
    return this.get(booking.id, actor);
  }
  async get(bookingId: string, actor: User) {
    const s = await this.store.read();
    const b = s.bookings.find((b) => b.id === bookingId);
    assert(
      b && (actor.role !== 'CUSTOMER' || b.userId === actor.id),
      404,
      'Reservation not found.',
    );
    return viewBooking(s, b, this.secret);
  }
  async action(bookingId: string, actor: User, action: string, now = new Date()) {
    return this.store.transaction((s) => {
      expireHolds(s, now);
      const b = s.bookings.find((b) => b.id === bookingId);
      assert(
        b && (actor.role !== 'CUSTOMER' || b.userId === actor.id),
        404,
        'Reservation not found.',
      );
      const before = b.status;
      if (action === 'cancel') {
        assert(
          ['PAYMENT_PENDING', 'CONFIRMED'].includes(b.status),
          409,
          'This reservation cannot be cancelled.',
        );
        b.status = 'CANCELLED';
        const p = s.payments.find((p) => p.bookingId === b.id);
        if (p?.status === 'CAPTURED') p.refundStatus = 'REVIEW';
        notify(
          s,
          b,
          'Reservation cancelled',
          'Your table has been released. Any paid deposit will be reviewed by the restaurant.',
          now,
        );
      } else {
        assert(actor.role !== 'CUSTOMER', 403, 'Staff access is required.');
        if (action === 'check-in') {
          assert(b.status === 'CONFIRMED', 409, 'Only a confirmed reservation can be seated.');
          assert(
            +now >= Date.parse(b.start) - 15 * 60_000 && +now < Date.parse(b.end),
            409,
            'Check-in opens 15 minutes before the booking and closes at its end.',
          );
          assert(
            !s.bookings.some(
              (other) =>
                other.id !== b.id && other.tableId === b.tableId && other.status === 'CHECKED_IN',
            ),
            409,
            'This table still has a seated party. Complete that visit first.',
          );
          assert(
            !s.bookings.some(
              (other) =>
                other.id !== b.id &&
                other.tableId === b.tableId &&
                ['CONFIRMED', 'PAYMENT_PENDING'].includes(other.status) &&
                Date.parse(other.start) <= +now &&
                Date.parse(other.end) > +now,
            ),
            409,
            'Another booking still occupies this time window.',
          );
          b.status = 'CHECKED_IN';
          b.checkedInAt = now.toISOString();
        } else if (action === 'complete') {
          assert(b.status === 'CHECKED_IN', 409, 'Only a seated party can be completed.');
          b.status = 'COMPLETED';
          b.completedAt = now.toISOString();
        } else if (action === 'no-show') {
          assert(
            b.status === 'CONFIRMED' &&
              +now >= Date.parse(b.start) + s.settings[0].graceMinutes * 60_000,
            409,
            'Wait until the arrival grace period ends.',
          );
          b.status = 'NO_SHOW';
          const p = s.payments.find((p) => p.bookingId === b.id);
          if (p?.status === 'CAPTURED') p.refundStatus = 'REVIEW';
          notify(
            s,
            b,
            'We missed you at Lopez',
            'Your reservation was marked as a no-show. Contact the restaurant about your deposit.',
            now,
          );
        } else throw new AppError(400, 'Unknown reservation action.');
      }
      if (['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(b.status))
        s.locks = s.locks.filter((l) => l.bookingId !== b.id);
      audit(
        s,
        actor,
        action.toUpperCase().replace('-', '_'),
        b.code,
        `${before} → ${b.status}`,
        now,
      );
      return viewBooking(s, b, this.secret);
    });
  }
  async lookup(value: string) {
    const s = await this.store.read();
    const b = s.bookings.find(
      (b) => b.code === value.toUpperCase() || b.ticketHash === hash(value),
    );
    assert(b, 404, 'Ticket not found. Check the code and try again.');
    return viewBooking(s, b, this.secret);
  }
  async captured(
    eventId: string,
    data: { id: string; order_id: string; amount: number; currency: string },
    now = new Date(),
  ) {
    await this.store.transaction((s) => {
      if (s.events.some((e) => e.id === eventId)) return;
      const p = s.payments.find((p) => p.orderId === data.order_id);
      assert(p, 409, 'Order is not ready. Retry the webhook.');
      assert(
        p.amount === data.amount && data.currency === 'INR',
        400,
        'Payment amount or currency does not match.',
      );
      if (p.paymentId && p.paymentId !== data.id)
        throw new AppError(
          409,
          'Unexpected additional payment on this order. Manual review is required.',
        );
      if (p.status !== 'CAPTURED') {
        expireHolds(s, now);
        p.status = 'CAPTURED';
        p.paymentId = data.id;
        const b = s.bookings.find((b) => b.id === p.bookingId)!;
        if (b.status === 'PAYMENT_PENDING') {
          b.status = 'CONFIRMED';
          notify(
            s,
            b,
            'Your table is reserved',
            'Your deposit is paid and your reservation is confirmed. Your QR ticket is ready.',
            now,
          );
          audit(s, system, 'PAYMENT_CONFIRMED', b.code, `INR ${(p.amount / 100).toFixed(2)}`, now);
        } else {
          // A cancelled or expired hold must never be resurrected by a late webhook.
          p.refundStatus = 'APPROVED';
          p.refundReason = 'Payment arrived after the checkout hold ended';
          notify(
            s,
            b,
            'Payment received after checkout closed',
            'Your table was not reserved. A full refund has been queued.',
            now,
          );
          audit(s, system, 'LATE_PAYMENT_REFUND', b.code, p.refundReason, now);
        }
      }
      s.events.push({ id: eventId, at: now.toISOString() });
    });
  }
  async refundDecision(paymentId: string, actor: User, approve: boolean, reason: string) {
    await this.store.transaction((s) => {
      const p = s.payments.find((p) => p.id === paymentId);
      assert(p, 404, 'Payment not found.');
      assert(p.refundStatus === 'REVIEW', 409, 'This refund already has a decision.');
      p.refundStatus = approve ? 'APPROVED' : 'REJECTED';
      p.refundReason = reason;
      const b = s.bookings.find((b) => b.id === p.bookingId)!;
      notify(
        s,
        b,
        approve ? 'Refund approved' : 'Refund review completed',
        `${approve ? 'Your full deposit refund has been approved.' : 'Your deposit refund was declined.'} ${reason}`,
      );
      audit(s, actor, approve ? 'REFUND_APPROVED' : 'REFUND_REJECTED', b.code, reason);
    });
  }
  async refunded(eventId: string, refund: RefundResult, failed = false) {
    await this.store.transaction((s) => {
      if (s.events.some((e) => e.id === eventId)) return;
      const p = s.payments.find((p) => p.paymentId === refund.payment_id);
      assert(p, 409, 'Payment is not ready. Retry the webhook.');
      assert(p.amount === refund.amount, 400, 'Partial refunds need manual reconciliation.');
      if (p.refundStatus !== 'REFUNDED') {
        p.refundId = refund.id;
        p.refundStatus = failed ? 'FAILED' : 'REFUNDED';
        const b = s.bookings.find((b) => b.id === p.bookingId)!;
        if (!failed)
          notify(
            s,
            b,
            'Your refund is processed',
            'Your full deposit has been refunded. Your bank may take a few days to show the credit.',
          );
        audit(s, system, failed ? 'REFUND_FAILED' : 'REFUND_PROCESSED', b.code, refund.id);
      }
      s.events.push({ id: eventId, at: new Date().toISOString() });
    });
  }
  async processRefunds() {
    const s = await this.store.read();
    for (const payment of s.payments.filter((p) => p.refundStatus === 'APPROVED')) {
      const claimed = await this.store.transaction((s) => {
        const p = s.payments.find((p) => p.id === payment.id)!;
        if (p.refundStatus !== 'APPROVED') return false;
        p.refundStatus = 'SUBMITTING';
        p.refundAttemptAt = new Date().toISOString();
        return true;
      });
      if (!claimed) continue;
      try {
        const refund = await this.gateway.refund(payment.paymentId!, payment.amount, payment.id);
        await this.store.transaction((s) => {
          const p = s.payments.find((p) => p.id === payment.id)!;
          p.refundId = refund.id;
          if (p.refundStatus === 'SUBMITTING') p.refundStatus = 'PENDING';
        });
        if (this.demo) await this.refunded(`demo:${refund.id}`, refund);
      } catch {
        // Never blindly resubmit an ambiguous provider response: the provider may
        // already have created the refund. Reconcile by receipt or webhook instead.
        await this.store.transaction((s) => {
          s.payments.find((p) => p.id === payment.id)!.error =
            'Refund response uncertain; reconciliation pending.';
        });
      }
    }
    for (const payment of s.payments.filter((p) =>
      ['SUBMITTING', 'PENDING'].includes(p.refundStatus),
    )) {
      if (payment.refundAttemptAt && Date.now() - Date.parse(payment.refundAttemptAt) < 60_000)
        continue;
      try {
        const refund = await this.gateway.findRefund(payment.paymentId!, payment.id);
        if (refund?.status === 'processed') await this.refunded(`reconcile:${refund.id}`, refund);
        else if (refund?.status === 'failed')
          await this.refunded(`reconcile-failed:${refund.id}`, refund, true);
      } catch {
        /* Leave the durable request visible for admin reconciliation. */
      }
    }
  }
}
