import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Armchair,
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  CreditCard,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { BookingView, Settings, Table } from '../shared/types';
import { api, dateInZone, day, invalidate, money, time } from './api';
import { useSession } from './App';
import { Badge, Empty, ErrorBox, Heading, Loading, Modal, TableDrawing } from './ui';

interface Availability {
  slots: string[];
  start?: string;
  end?: string;
  tables: (Table & { available: boolean })[];
  settings: Settings;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open(): void;
      on(event: string, callback: (error: unknown) => void): void;
    };
  }
}
export function BookPage() {
  const { settings } = useSession();
  const [params, setParams] = useSearchParams();
  const [date, setDate] = useState(dateInZone(new Date(), settings.timezone)),
    [start, setStart] = useState(''),
    [party, setParty] = useState(2),
    [selected, setSelected] = useState(''),
    [notes, setNotes] = useState('');
  const { data, error, isLoading } = useQuery({
    queryKey: ['availability', date, party, start],
    queryFn: () =>
      api<Availability>(
        `/availability?date=${date}&partySize=${party}${start ? `&start=${encodeURIComponent(start)}` : ''}`,
      ),
    refetchInterval: 15000,
  });
  const chosen = data?.tables.find((t) => t.id === selected && t.available);
  const mutation = useMutation({
    mutationFn: () =>
      api<BookingView>('/bookings', {
        method: 'POST',
        body: { tableId: chosen!.id, partySize: party, start: data!.start, notes },
      }),
    onSuccess: (b) => {
      setParams({ checkout: b.id });
      void invalidate();
    },
  });
  return (
    <>
      <Heading
        eyebrow="SOMETHING GOOD IS ON THE MENU"
        title="Your evening starts here."
        description="Pick your moment. Find your table. We’ll take care of the welcome."
      />
      <div className="booking-banner">
        <div>
          <span className="eyebrow">THE LOPEZ EXPERIENCE</span>
          <h2>
            Good company deserves
            <br />a great table.
          </h2>
          <p>Thoughtful food. Familiar faces. A little time together.</p>
        </div>
        <div className="banner-table">
          <TableDrawing capacity={6} state="occupied" />
        </div>
        <div className="banner-facts">
          <span>
            <Clock3 size={17} />
            {settings.durationMinutes}-minute sittings
          </span>
          <span>
            <CreditCard size={17} />
            {money(settings.depositPaise)} reservation deposit
          </span>
          <span>
            <Armchair size={17} />
            Choose your exact table
          </span>
        </div>
      </div>
      <div className="booking-layout">
        <section>
          <div className="panel booking-filters">
            <label>
              <span>
                <CalendarDays size={16} /> Date
              </span>
              <input
                type="date"
                min={dateInZone(new Date(), settings.timezone)}
                value={date}
                required
                onChange={(e) => {
                  if (e.target.value) {
                    setDate(e.target.value);
                    setStart('');
                    setSelected('');
                  }
                }}
              />
            </label>
            <label>
              <span>
                <Users size={16} /> Party size
              </span>
              <select
                value={party}
                onChange={(e) => {
                  setParty(Number(e.target.value));
                  setSelected('');
                }}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? 'guest' : 'guests'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>
                <Clock3 size={16} /> Arrival time
              </span>
              <select
                value={data?.start ?? start}
                onChange={(e) => {
                  setStart(e.target.value);
                  setSelected('');
                }}
                disabled={!data?.slots.length}
              >
                {data?.slots.length ? (
                  data.slots.map((s) => (
                    <option key={s} value={s}>
                      {time(s, settings.timezone)}
                    </option>
                  ))
                ) : (
                  <option>No available times</option>
                )}
              </select>
            </label>
          </div>
          <ErrorBox error={error} />
          <div className="section-heading booking-table-heading">
            <div>
              <h2>Find your favorite spot</h2>
              <p>
                {data?.tables.filter((t) => t.available).length ?? 0} tables available for your
                visit
              </p>
            </div>
            <span className="available-key">
              <i />
              Available
            </span>
          </div>
          {isLoading ? (
            <Loading />
          ) : !data?.slots.length ? (
            <Empty title="No sittings on this date">Try another day. We’d love to have you.</Empty>
          ) : (
            <div className="customer-table-grid">
              {data.tables.map((t) => (
                <button
                  key={t.id}
                  className={`choice-table ${selected === t.id ? 'selected' : ''}`}
                  disabled={!t.available}
                  onClick={() => setSelected(t.id)}
                  aria-pressed={selected === t.id}
                >
                  <div>
                    <strong>Table {t.number}</strong>
                    {selected === t.id ? (
                      <span className="selected-check">
                        <Check size={13} />
                      </span>
                    ) : (
                      <span className={`availability-dot ${t.available ? '' : 'unavailable'}`} />
                    )}
                  </div>
                  <TableDrawing
                    capacity={t.capacity}
                    state={selected === t.id ? 'occupied' : 'available'}
                  />
                  <strong>{t.area}</strong>
                  <span>
                    <Users size={13} />
                    {t.capacity} seats <i /> {t.available ? 'Available' : 'Unavailable'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
        <aside className="booking-summary panel">
          <span className="eyebrow">YOUR NEXT GOOD EVENING</span>
          <h2>A place at our table.</h2>
          {chosen ? (
            <>
              <div className="selected-table-name">
                <Armchair size={22} />
                <div>
                  <strong>Table {chosen.number}</strong>
                  <span>{chosen.area}</span>
                </div>
                <Check size={18} />
              </div>
              <dl className="detail-list">
                <div>
                  <dt>Date</dt>
                  <dd>{day(`${date}T12:00:00`, settings.timezone)}</dd>
                </div>
                <div>
                  <dt>Time</dt>
                  <dd>{data?.start && time(data.start, settings.timezone)}</dd>
                </div>
                <div>
                  <dt>Your party</dt>
                  <dd>{party} guests</dd>
                </div>
                <div>
                  <dt>Visit length</dt>
                  <dd>{settings.durationMinutes} minutes</dd>
                </div>
              </dl>
              <label>
                Anything we should know?
                <textarea
                  maxLength={500}
                  placeholder="A special occasion or accessibility request…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <div className="deposit-total">
                <span>Reservation deposit</span>
                <strong>{money(settings.depositPaise)}</strong>
              </div>
              <ErrorBox error={mutation.error} />
              <button
                className="button full"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? 'Holding your table…' : 'Reserve this table'}
                <ArrowRight size={17} />
              </button>
              <p className="fine-print">
                Your table is held for 10 minutes during checkout. Confirmed after payment.
                Cancellation refunds are reviewed by the restaurant.
              </p>
            </>
          ) : (
            <div className="summary-empty">
              <Armchair size={32} />
              <p>
                A table is waiting for you.
                <br />
                Choose a spot to see the details.
              </p>
            </div>
          )}
          <div className="summary-footer">
            <ShieldCheck size={17} />
            Secure checkout · Instant confirmation
          </div>
        </aside>
      </div>
      {params.get('checkout') && (
        <CheckoutModal bookingId={params.get('checkout')!} onClose={() => setParams({})} />
      )}
    </>
  );
}
function CheckoutModal({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const { mode, settings, user } = useSession();
  const [now, setNow] = useState(Date.now()),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [waiting, setWaiting] = useState(false),
    [gatewayOpen, setGatewayOpen] = useState(false);
  const { data: b, error: loadError } = useQuery({
    queryKey: ['booking', bookingId],
    queryFn: () => api<BookingView>(`/bookings/${bookingId}`),
    refetchInterval: 2000,
  });
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (b?.status === 'CONFIRMED') {
      void invalidate();
      navigate(`/ticket/${bookingId}`);
    }
  }, [b?.status, bookingId, navigate]);
  const remaining = Math.max(
    0,
    Math.floor(((b?.holdUntil ? Date.parse(b.holdUntil) : now) - now) / 1000),
  );
  async function pay() {
    setBusy(true);
    setError(undefined);
    try {
      if (mode === 'demo') {
        await api(`/checkout/${bookingId}/demo-pay`, { method: 'POST' });
        await invalidate();
      } else {
        const checkout = await api<{
          key: string;
          orderId: string;
          amount: number;
          currency: string;
        }>(`/checkout/${bookingId}`);
        if (!window.Razorpay)
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://checkout.razorpay.com/v1/checkout.js';
            script.onload = () => resolve();
            script.onerror = () =>
              reject(new Error('Unable to load secure checkout. Check your connection.'));
            document.body.appendChild(script);
          });
        const razorpay = new window.Razorpay!({
          key: checkout.key,
          order_id: checkout.orderId,
          amount: checkout.amount,
          currency: checkout.currency,
          name: settings.name,
          description: `Table ${b?.tableNumber} reservation`,
          prefill: { name: user?.name, email: user?.email },
          theme: { color: '#a24832' },
          handler: () => {
            setGatewayOpen(false);
            setWaiting(true);
            void invalidate();
          },
          modal: {
            ondismiss: () => {
              setBusy(false);
              setGatewayOpen(false);
            },
          },
        });
        razorpay.on('payment.failed', () => {
          setError(new Error('Payment was not completed. You may retry while the hold is active.'));
          setBusy(false);
        });
        // Native dialogs make the rest of the document inert. Remove our dialog
        // before Razorpay attaches its checkout iframe to the document body.
        flushSync(() => setGatewayOpen(true));
        razorpay.open();
      }
    } catch (e) {
      setError(e);
      setGatewayOpen(false);
    } finally {
      setBusy(false);
    }
  }
  if (gatewayOpen) return null;
  return (
    <Modal
      title="Your table is on hold."
      subtitle="One last step before we set your place."
      onClose={onClose}
    >
      {!b ? (
        <>
          <Loading />
          <ErrorBox error={loadError} />
        </>
      ) : (
        <>
          <div className="checkout-clock">
            <Clock3 size={24} />
            <div>
              <strong>
                {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
              </strong>
              <span>remaining to confirm your table</span>
            </div>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Table</dt>
              <dd>
                {b.tableNumber} · {b.partySize} guests
              </dd>
            </div>
            <div>
              <dt>Visit</dt>
              <dd>
                {day(b.start, settings.timezone)}, {time(b.start, settings.timezone)}
              </dd>
            </div>
            <div>
              <dt>Deposit</dt>
              <dd>{money(b.depositPaise)}</dd>
            </div>
          </dl>
          {waiting && (
            <div className="info-box">
              Payment submitted. Waiting for verified confirmation from the provider. You can safely
              close this window and check My bookings.
            </div>
          )}
          {mode === 'demo' && (
            <div className="info-box">Demo checkout — no money will be charged.</div>
          )}
          <ErrorBox error={error} />
          {remaining && b.status === 'PAYMENT_PENDING' ? (
            <button className="button full" disabled={busy || waiting} onClick={pay}>
              <CreditCard size={18} />
              {busy
                ? 'Processing…'
                : mode === 'demo'
                  ? `Simulate ${money(b.depositPaise)} payment`
                  : `Pay ${money(b.depositPaise)} securely`}
            </button>
          ) : (
            <p className="error">This hold has ended. Please choose a table again.</p>
          )}
          <p className="fine-print">
            Closing this window does not cancel the hold. You can resume checkout from My bookings
            until the timer ends.
          </p>
        </>
      )}
    </Modal>
  );
}
export function MyBookingsPage() {
  const { settings } = useSession();
  const [tab, setTab] = useState('upcoming');
  const { data, error, isLoading } = useQuery({
    queryKey: ['bookings'],
    queryFn: () => api<BookingView[]>('/bookings'),
    refetchInterval: 10000,
  });
  const bookings = data?.filter((b) =>
    tab === 'upcoming'
      ? ['PAYMENT_PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(b.status)
      : !['PAYMENT_PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(b.status),
  );
  return (
    <>
      <Heading
        eyebrow="GOOD TIMES, SAVED"
        title="Your visits to Lopez."
        description="A little anticipation is part of the experience."
        actions={
          <Link className="button" to="/book">
            <Armchair size={17} /> Find a table
          </Link>
        }
      />
      <div className="tabs standalone-tabs">
        <button className={tab === 'upcoming' ? 'active' : ''} onClick={() => setTab('upcoming')}>
          Upcoming visits
        </button>
        <button className={tab === 'past' ? 'active' : ''} onClick={() => setTab('past')}>
          Past visits
        </button>
      </div>
      <ErrorBox error={error} />
      {isLoading ? (
        <Loading />
      ) : bookings?.length ? (
        <div className="my-booking-grid">
          {bookings.map((b) => (
            <Link className="my-booking-card panel" key={b.id} to={`/ticket/${b.id}`}>
              <div>
                <span className="eyebrow">{b.code}</span>
                <Badge value={b.status} />
              </div>
              <h2>Table {b.tableNumber}</h2>
              <p>
                {day(b.start, settings.timezone)} · {time(b.start, settings.timezone)}
              </p>
              <div className="booking-card-footer">
                <span>
                  <Users size={15} />
                  {b.partySize} guests
                </span>
                <span>
                  View ticket <ArrowRight size={16} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          title={tab === 'upcoming' ? 'Your next good evening awaits.' : 'Your story starts here.'}
        >
          Reserve a table and we’ll save your visits here.
        </Empty>
      )}
    </>
  );
}
