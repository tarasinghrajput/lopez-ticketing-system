import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  Clock3,
  Download,
  Plus,
  ScanLine,
  Search,
  Users,
  Armchair,
  SlidersHorizontal,
  LayoutGrid,
  List,
  Printer,
  CircleCheck,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { BookingView, Dashboard, TableView } from '../shared/types';
import { api, dateInZone, day, invalidate, money, time } from './api';
import { useSession } from './App';
import { Badge, Empty, ErrorBox, Heading, Loading, Modal, Stat, TableDrawing } from './ui';

export function DashboardPage() {
  const { settings } = useSession();
  const navigate = useNavigate();
  const [date, setDate] = useState(dateInZone(new Date(), settings.timezone));
  const [filter, setFilter] = useState('all'),
    [area, setArea] = useState('All spaces'),
    [search, setSearch] = useState(''),
    [list, setList] = useState(false);
  const [scan, setScan] = useState(false),
    [selectedTable, setSelectedTable] = useState<string>();
  const { openWalkIn } = useOutletContext<{ openWalkIn: () => void }>();
  const { data, error, isLoading } = useQuery({
    queryKey: ['dashboard', date],
    queryFn: () => api<Dashboard>(`/staff/dashboard?date=${date}`),
    refetchInterval: 15000,
  });
  if (isLoading) return <Loading />;
  if (!data) return <ErrorBox error={error} />;
  const activeTables = data.tables.filter((t) => t.active),
    occupied = data.tables.filter((t) => ['occupied', 'overdue'].includes(t.state));
  const upcoming = data.bookings.filter((b) => b.status === 'CONFIRMED').slice(0, 4);
  const tables = data.tables.filter(
    (t) =>
      (filter === 'all' ||
        (filter === 'occupied' ? ['occupied', 'overdue'].includes(t.state) : t.state === filter)) &&
      (area === 'All spaces' || t.area === area) &&
      `${t.number} ${t.current?.guestName ?? ''} ${t.upcoming?.guestName ?? ''}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const totalGuests = data.bookings
    .filter((b) => ['CHECKED_IN', 'COMPLETED', 'CONFIRMED'].includes(b.status))
    .reduce((sum, b) => sum + b.partySize, 0);
  return (
    <>
      <Heading
        eyebrow="A LITTLE ORDER. A LOT OF HOSPITALITY."
        title="Your dining room, at a glance."
        description="Every table, every guest, every moment. All in one place."
        actions={
          <>
            <button className="button secondary" onClick={() => setScan(true)}>
              <ScanLine size={17} /> Scan ticket
            </button>
            <button className="button" onClick={openWalkIn}>
              <Plus size={18} /> New walk-in
            </button>
          </>
        }
      />
      <div className="date-row">
        <div className="day-label">
          <span className="live-dot" /> Restaurant overview <span className="muted">/</span>{' '}
          <strong>{day(`${date}T12:00:00`, settings.timezone)}</strong>
        </div>
        <label className="date-input">
          <CalendarDays size={16} />
          <input
            type="date"
            aria-label="Dashboard date"
            value={date}
            onChange={(e) => setDate(e.target.value || date)}
          />
        </label>
      </div>
      <div className="stats-grid">
        <Stat
          label="Available tables"
          value={activeTables
            .filter((t) => t.state === 'available')
            .length.toString()
            .padStart(2, '0')}
          foot={`Of ${activeTables.length} tables in your restaurant`}
          icon={<Armchair size={19} />}
        />
        <Stat
          label="Currently seated"
          value={occupied.length.toString().padStart(2, '0')}
          foot={`${occupied.reduce((n, t) => n + (t.current?.partySize ?? 0), 0)} guests enjoying their visit`}
          icon={<Users size={19} />}
        />
        <Stat
          label="Reservations"
          value={data.bookings
            .filter((b) => ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(b.status))
            .length.toString()
            .padStart(2, '0')}
          foot={`${data.bookings.filter((b) => b.status === 'CONFIRMED').length} parties still to arrive`}
          icon={<CalendarDays size={19} />}
        />
        <Stat
          label="Expected guests"
          value={totalGuests.toString().padStart(2, '0')}
          foot="A place for every guest"
          icon={<CircleCheck size={19} />}
        />
      </div>
      <div className="operations-layout">
        <section className="table-section">
          <div className="section-heading">
            <div>
              <h2>
                The dining room <span className="count-chip">{activeTables.length} tables</span>
              </h2>
              <p>A real-time view of the floor.</p>
            </div>
            <div className="view-switch" aria-label="Table display">
              <button
                aria-label="Grid view"
                className={!list ? 'active' : ''}
                onClick={() => setList(false)}
              >
                <LayoutGrid size={17} />
              </button>
              <button
                aria-label="List view"
                className={list ? 'active' : ''}
                onClick={() => setList(true)}
              >
                <List size={18} />
              </button>
            </div>
          </div>
          <div className="table-toolbar">
            <div className="tabs">
              {[
                ['all', 'All tables'],
                ['available', 'Available'],
                ['occupied', 'Occupied'],
                ['reserved', 'Reserved'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? 'active' : ''}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="space-filter">
              <SlidersHorizontal size={15} />
              <select
                aria-label="Dining area"
                value={area}
                onChange={(e) => setArea(e.target.value)}
              >
                {['All spaces', ...new Set(data.tables.map((t) => t.area))].map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="table-search">
            <Search size={16} />
            <input
              aria-label="Search tables or guests"
              placeholder="Find a table or guest…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span>{tables.length} tables</span>
          </div>
          <div className={`table-grid ${list ? 'list-view' : ''}`}>
            {tables.map((t) => (
              <TableCard
                key={t.id}
                table={t}
                zone={settings.timezone}
                onClick={() =>
                  t.current ? navigate(`/ticket/${t.current.id}`) : setSelectedTable(t.id)
                }
              />
            ))}
          </div>
          {!tables.length && (
            <Empty title="No tables match">Try a different status, space, or guest name.</Empty>
          )}
          <div className="table-legend">
            <span>
              <i className="dot-available" /> Available
            </span>
            <span>
              <i className="dot-occupied" /> Occupied
            </span>
            <span>
              <i className="dot-reserved" /> Reserved
            </span>
            <span>
              <i className="dot-held" /> Payment hold
            </span>
            <span className="refresh-note">Updates every 15 seconds</span>
          </div>
        </section>
        <aside className="arrivals-panel">
          <div className="section-heading">
            <div>
              <h2>On their way</h2>
              <p>The next warm welcomes.</p>
            </div>
            <span className="count-chip">{upcoming.length}</span>
          </div>
          {upcoming.length ? (
            upcoming.map((b) => (
              <Link to={`/ticket/${b.id}`} className="arrival" key={b.id}>
                <div className="arrival-time">{time(b.start, settings.timezone)}</div>
                <div className="arrival-person">
                  <span className="guest-avatar">
                    {b.guestName
                      .split(' ')
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join('')}
                  </span>
                  <div>
                    <strong>{b.guestName}</strong>
                    <span>
                      {b.partySize} guests <i /> Table {b.tableNumber}
                    </span>
                  </div>
                  <ArrowUpRight size={16} />
                </div>
                <div className="arrival-status">
                  <Badge value="CONFIRMED" />
                  <span>{b.source === 'ONLINE' ? 'Online booking' : 'Walk-in'}</span>
                </div>
              </Link>
            ))
          ) : (
            <Empty title="All caught up">Upcoming reservations for this date appear here.</Empty>
          )}
          <Link className="text-link view-reservations" to="/reservations">
            View all reservations <ArrowRight size={16} />
          </Link>
          <div className="hospitality-note">
            <span>THE LITTLE THINGS</span>
            <h3>
              A warm welcome
              <br />
              goes a long way.
            </h3>
            <p>
              A name remembered.
              <br />A table ready. An evening made.
            </p>
            <UtensilDecoration />
          </div>
        </aside>
      </div>
      {scan && <ScannerModal onClose={() => setScan(false)} />}{' '}
      {selectedTable && (
        <WalkInModal tableId={selectedTable} onClose={() => setSelectedTable(undefined)} />
      )}
    </>
  );
}
function UtensilDecoration() {
  return (
    <svg viewBox="0 0 90 90" aria-hidden="true">
      <circle cx="45" cy="45" r="24" fill="none" stroke="currentColor" />
      <circle cx="45" cy="45" r="17" fill="none" stroke="currentColor" />
      <path
        d="M11 17v21q0 7 7 7V75M18 17v23M25 17v21q0 7-7 7M77 17v58M77 17q-12 8-8 27h8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
function TableCard({
  table: t,
  zone,
  onClick,
}: {
  table: TableView;
  zone: string;
  onClick: () => void;
}) {
  const remaining = t.current ? Math.ceil((Date.parse(t.current.end) - Date.now()) / 60000) : 0;
  return (
    <button
      className={`table-card state-${t.state}`}
      onClick={onClick}
      disabled={!t.active}
      aria-label={`Table ${t.number}, ${t.state}, ${t.capacity} seats`}
    >
      <div className="table-card-head">
        <strong>Table {t.number}</strong>
        <Badge value={t.state} />
      </div>
      <TableDrawing capacity={t.capacity} state={t.state} />
      <div className="table-card-guest">
        {t.current
          ? t.current.guestName
          : t.state === 'unavailable'
            ? 'Taking a break'
            : 'Ready for a welcome'}
      </div>
      <div className="table-card-meta">
        <Users size={13} />
        {t.current ? `${t.current.partySize} guests` : `${t.capacity} seats`}
        <span>·</span>
        {t.area}
      </div>
      <div className="table-card-bottom">
        {t.current ? (
          <>
            <Clock3 size={13} />
            {['occupied', 'overdue'].includes(t.state)
              ? remaining > 0
                ? `${remaining} min remaining`
                : `${Math.abs(remaining)} min over time`
              : `${time(t.current.start, zone)} – ${time(t.current.end, zone)}`}
          </>
        ) : t.upcoming ? (
          <>
            <CalendarDays size={13} />
            Next at {time(t.upcoming.start, zone)}
          </>
        ) : (
          <>
            <span className="small-dot" />
            No upcoming reservation
          </>
        )}
        <ArrowUpRight size={14} />
      </div>
    </button>
  );
}
export function ReservationsPage() {
  const { settings } = useSession();
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('ALL'),
    [date, setDate] = useState('');
  const { data, error, isLoading } = useQuery({
    queryKey: ['bookings'],
    queryFn: () => api<BookingView[]>('/bookings'),
    refetchInterval: 15000,
  });
  const { openWalkIn } = useOutletContext<{ openWalkIn: () => void }>();
  const results = data?.filter(
    (b) =>
      `${b.code} ${b.guestName} ${b.tableNumber}`.toLowerCase().includes(search.toLowerCase()) &&
      (status === 'ALL' || b.status === status) &&
      (!date || dateInZone(new Date(b.start), settings.timezone) === date),
  );
  return (
    <>
      <Heading
        eyebrow="EVERY VISIT, IN VIEW"
        title="Reservations"
        description="From the first hello to the last goodnight."
        actions={
          <button className="button" onClick={openWalkIn}>
            <Plus size={18} /> New walk-in
          </button>
        }
      />
      <div className="panel">
        <div className="filters-row">
          <label className="search-field">
            <Search size={17} />
            <input
              placeholder="Search guest, table, or booking code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label="Reservation status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {[
              'ALL',
              'CONFIRMED',
              'CHECKED_IN',
              'COMPLETED',
              'CANCELLED',
              'NO_SHOW',
              'PAYMENT_PENDING',
              'EXPIRED',
            ].map((v) => (
              <option key={v} value={v}>
                {v.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          <input
            type="date"
            aria-label="Reservation date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          {date && (
            <button className="text-link" onClick={() => setDate('')}>
              Clear date
            </button>
          )}
        </div>
        <ErrorBox error={error} />
        {isLoading ? (
          <Loading />
        ) : results?.length ? (
          <div className="table-overflow">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Guest</th>
                  <th>Table / party</th>
                  <th>Reservation</th>
                  <th>Status</th>
                  <th>Deposit</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.guestName}</strong>
                      <small>{b.code}</small>
                    </td>
                    <td>
                      Table {b.tableNumber}
                      <small>
                        {b.partySize} guests · {b.source === 'ONLINE' ? 'Online' : 'Walk-in'}
                      </small>
                    </td>
                    <td>
                      {day(b.start, settings.timezone)}
                      <small>
                        {time(b.start, settings.timezone)} – {time(b.end, settings.timezone)}
                      </small>
                    </td>
                    <td>
                      <Badge value={b.status} />
                    </td>
                    <td>
                      {money(b.depositPaise)}
                      <small>
                        {b.source === 'WALK_IN' ? 'Waived' : b.payment?.status.toLowerCase()}
                      </small>
                    </td>
                    <td>
                      <Link
                        to={`/ticket/${b.id}`}
                        className="icon-button"
                        aria-label={`View ${b.code}`}
                      >
                        <ArrowUpRight size={19} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No reservations found">New reservations will appear here.</Empty>
        )}
      </div>
    </>
  );
}
export function WalkInModal({ onClose, tableId = '' }: { onClose: () => void; tableId?: string }) {
  const navigate = useNavigate();
  const [name, setName] = useState(''),
    [partySize, setPartySize] = useState(2),
    [table, setTable] = useState(tableId),
    [email, setEmail] = useState(''),
    [phone, setPhone] = useState('');
  const { data } = useQuery({
    queryKey: ['dashboard-walkin'],
    queryFn: () => api<Dashboard>('/staff/dashboard'),
    refetchInterval: 15000,
  });
  const mutation = useMutation({
    mutationFn: () =>
      api<BookingView>('/staff/walk-ins', {
        method: 'POST',
        body: {
          guestName: name,
          partySize,
          tableId: table,
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
        },
      }),
    onSuccess: (b) => {
      void invalidate();
      onClose();
      navigate(`/ticket/${b.id}`);
    },
  });
  const duration = data?.settings.durationMinutes ?? 90;
  const available = data?.tables.filter(
    (t) =>
      t.active &&
      t.capacity >= partySize &&
      t.state === 'available' &&
      (!t.upcoming || Date.parse(t.upcoming.start) >= Date.now() + duration * 60000),
  );
  return (
    <Modal
      title="A warm welcome."
      subtitle="Seat a walk-in and issue their digital ticket."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <label>
          Guest name
          <input
            autoFocus
            required
            maxLength={100}
            placeholder="Who are we welcoming?"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            Party size
            <input
              type="number"
              min="1"
              max="30"
              required
              value={partySize}
              onChange={(e) => {
                setPartySize(Number(e.target.value));
                setTable('');
              }}
            />
          </label>
          <label>
            Table
            <select required value={table} onChange={(e) => setTable(e.target.value)}>
              <option value="">Choose a table</option>
              {available?.map((t) => (
                <option key={t.id} value={t.id}>
                  Table {t.number} · {t.capacity} seats
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Email <span className="muted">(optional)</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="guest@example.com"
          />
        </label>
        <label>
          Phone <span className="muted">(optional)</span>
          <input
            type="tel"
            maxLength={30}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Contact number"
          />
        </label>
        <div className="info-box">
          <Clock3 size={18} />
          <span>{duration}-minute visit starting now. Online deposit waived for walk-ins.</span>
        </div>
        {available?.length === 0 && (
          <p className="muted">No table can fit a complete visit right now.</p>
        )}
        <ErrorBox error={mutation.error} />
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={mutation.isPending || !table}>
            {mutation.isPending ? 'Seating…' : 'Seat guest & issue ticket'}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function ScannerModal({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState(''),
    [camera, setCamera] = useState(false),
    [cameraError, setCameraError] = useState<unknown>();
  const navigate = useNavigate();
  const scanner = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const lookup = useMutation({
    mutationFn: (code: string) =>
      api<BookingView>('/staff/ticket-lookup', { method: 'POST', body: { value: code } }),
    onSuccess: (b) => {
      onClose();
      navigate(`/ticket/${b.id}`);
    },
  });
  useEffect(() => {
    if (!camera) return;
    let disposed = false;
    void import('html5-qrcode').then(async ({ Html5Qrcode }) => {
      if (disposed) return;
      const reader = new Html5Qrcode('ticket-camera');
      try {
        await reader.start(
          { facingMode: 'environment' },
          { fps: 8, qrbox: { width: 220, height: 220 } },
          (code) => {
            if (!disposed) {
              disposed = true;
              lookup.mutate(code);
            }
          },
          () => {},
        );
        scanner.current = reader;
        if (disposed) {
          await reader.stop();
          reader.clear();
        }
      } catch (e) {
        if (!disposed)
          setCameraError(
            e instanceof Error ? e : 'Camera access is unavailable. Enter the booking code below.',
          );
      }
    });
    return () => {
      disposed = true;
      if (scanner.current)
        void scanner.current
          .stop()
          .then(() => scanner.current?.clear())
          .catch(() => {});
    };
  }, [camera]);
  return (
    <Modal
      title="Scan a ticket"
      subtitle="Validate a guest’s ticket before seating them."
      onClose={onClose}
    >
      <div id="ticket-camera" className={camera ? 'camera-preview' : ''} />
      {!camera && (
        <button className="scan-placeholder" onClick={() => setCamera(true)}>
          <ScanLine size={40} />
          <strong>Open camera</strong>
          <span>Use your device to scan the guest’s QR code</span>
        </button>
      )}
      <ErrorBox error={cameraError} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          lookup.mutate(value);
        }}
      >
        <label>
          Or enter the booking code
          <input
            autoFocus
            placeholder="LP-XXXXXXXX"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        </label>
        <ErrorBox error={lookup.error} />
        <button className="button full" disabled={lookup.isPending}>
          Find reservation <ArrowRight size={17} />
        </button>
      </form>
    </Modal>
  );
}
export function TicketPage() {
  const { id } = useParams();
  const { user, settings } = useSession();
  const [confirm, setConfirm] = useState<string>();
  const {
    data: b,
    error,
    isLoading,
  } = useQuery({
    queryKey: ['booking', id],
    queryFn: () => api<BookingView>(`/bookings/${id}`),
    refetchInterval: 5000,
  });
  const mutation = useMutation({
    mutationFn: (action: string) =>
      api(`/bookings/${id}/actions`, { method: 'POST', body: { action } }),
    onSuccess: () => {
      setConfirm(undefined);
      void invalidate();
    },
  });
  if (isLoading) return <Loading />;
  if (!b) return <ErrorBox error={error} />;
  const staff = user!.role !== 'CUSTOMER';
  return (
    <>
      <Link className="back-link" to={staff ? '/reservations' : '/my-bookings'}>
        <ArrowLeft size={16} /> All reservations
      </Link>
      <Heading
        eyebrow="A PLACE SAVED FOR YOU"
        title="Your table ticket."
        description="All the details for a lovely visit."
        actions={
          <button className="button secondary" onClick={() => window.print()}>
            <Printer size={17} /> Print ticket
          </button>
        }
      />
      <div className="ticket-layout">
        <section className="ticket">
          <div className="ticket-header">
            <div className="ticket-brand">lopez.</div>
            <span>TABLE & TICKET</span>
            <Badge value={b.status} />
          </div>
          <div className="ticket-main">
            <span className="eyebrow">YOU’RE EXPECTED AT</span>
            <h2>Table {b.tableNumber}</h2>
            <p>
              {b.guestName} · {b.partySize} guests
            </p>
            <div className="ticket-qr">
              {b.ticketToken ? (
                <QRCodeSVG value={b.ticketToken} size={176} level="M" marginSize={2} />
              ) : (
                <div className="ticket-inactive">
                  <ScanLine size={44} />
                  <span>
                    {b.status === 'PAYMENT_PENDING'
                      ? 'Your QR ticket appears after payment.'
                      : 'This ticket is no longer active.'}
                  </span>
                </div>
              )}
            </div>
            <strong className="booking-code">{b.code}</strong>
            <span className="muted ticket-instruction">
              {b.ticketToken
                ? 'Show this ticket to our team when you arrive.'
                : 'Keep this code for your records.'}
            </span>
          </div>
          <div className="ticket-tear" />
          <div className="ticket-details">
            <div>
              <span>Date</span>
              <strong>{day(b.start, settings.timezone)}</strong>
            </div>
            <div>
              <span>Visit time</span>
              <strong>
                {time(b.start, settings.timezone)} – {time(b.end, settings.timezone)}
              </strong>
            </div>
            <div>
              <span>Deposit</span>
              <strong>{b.source === 'WALK_IN' ? 'Waived · walk-in' : money(b.depositPaise)}</strong>
            </div>
            <div>
              <span>Payment</span>
              <strong>{b.payment?.status.toLowerCase() ?? 'Not required'}</strong>
            </div>
          </div>
          <div className="ticket-footer">Good food tastes better together.</div>
        </section>
        <aside className="ticket-side">
          <div className="panel">
            <h2>Reservation details</h2>
            <dl className="detail-list">
              <div>
                <dt>Guest</dt>
                <dd>{b.guestName}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{b.email ?? 'Not provided'}</dd>
              </div>
              {b.phone && (
                <div>
                  <dt>Phone</dt>
                  <dd>{b.phone}</dd>
                </div>
              )}
              <div>
                <dt>Visit length</dt>
                <dd>{Math.round((Date.parse(b.end) - Date.parse(b.start)) / 60000)} minutes</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{b.source === 'ONLINE' ? 'Online reservation' : 'Walk-in'}</dd>
              </div>
              {b.payment && (
                <div>
                  <dt>Refund</dt>
                  <dd>{b.payment.refundStatus.replaceAll('_', ' ').toLowerCase()}</dd>
                </div>
              )}
              {b.checkedInAt && (
                <div>
                  <dt>Seated at</dt>
                  <dd>{time(b.checkedInAt, settings.timezone)}</dd>
                </div>
              )}
            </dl>
            {b.notes && <p className="info-box">{b.notes}</p>}
            <div className="ticket-actions">
              {staff && b.status === 'CONFIRMED' && (
                <button className="button full" onClick={() => setConfirm('check-in')}>
                  <Check size={18} /> Check in & seat
                </button>
              )}
              {staff && b.status === 'CHECKED_IN' && (
                <button className="button full" onClick={() => setConfirm('complete')}>
                  <CircleCheck size={18} /> Complete visit
                </button>
              )}
              {b.status === 'PAYMENT_PENDING' && (
                <Link className="button full" to={`/book?checkout=${b.id}`}>
                  Continue checkout <ArrowRight size={17} />
                </Link>
              )}
              {['PAYMENT_PENDING', 'CONFIRMED'].includes(b.status) && (
                <button className="button secondary full" onClick={() => setConfirm('cancel')}>
                  Cancel reservation
                </button>
              )}
              {staff && b.status === 'CONFIRMED' && (
                <button className="text-link muted" onClick={() => setConfirm('no-show')}>
                  Mark as no-show
                </button>
              )}
            </div>
          </div>
          <div className="info-box">
            <Clock3 size={20} />
            <p>
              Please arrive at your reserved time. Late arrivals have a {settings.graceMinutes}
              -minute grace period. Refunds are reviewed by the restaurant.
            </p>
          </div>
        </aside>
      </div>
      {confirm && (
        <Modal
          title={`${confirm === 'check-in' ? 'Seat this party' : confirm === 'complete' ? 'Complete this visit' : confirm === 'cancel' ? 'Cancel this reservation' : 'Mark as no-show'}?`}
          onClose={() => setConfirm(undefined)}
        >
          <p>
            {confirm === 'cancel'
              ? 'This releases the table. Any paid deposit will be sent to the admin for refund review.'
              : `Update ${b.guestName}’s reservation for Table ${b.tableNumber}.`}
          </p>
          <ErrorBox error={mutation.error} />
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setConfirm(undefined)}>
              Go back
            </button>
            <button
              className="button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(confirm)}
            >
              Confirm
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
