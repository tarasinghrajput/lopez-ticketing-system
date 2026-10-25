import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Plus,
  Pencil,
  Armchair,
  Users,
  ArrowUpRight,
  Check,
  Save,
  Mail,
  ShieldCheck,
  Search,
  X,
} from 'lucide-react';
import type { Audit, Booking, Invite, Payment, Settings, Table, User } from '../shared/types';
import { api, day, invalidate, money, time } from './api';
import { useSession } from './App';
import { Badge, Empty, ErrorBox, Heading, Loading, Modal, TableDrawing } from './ui';

export function TablesPage() {
  const [editing, setEditing] = useState<Table | 'new'>();
  const { data, error, isLoading } = useQuery({
    queryKey: ['tables'],
    queryFn: () => api<Table[]>('/admin/tables'),
  });
  return (
    <>
      <Heading
        eyebrow="A SPACE FOR EVERY OCCASION"
        title="Tables & spaces"
        description="Make your dining room feel just right."
        actions={
          <button className="button" onClick={() => setEditing('new')}>
            <Plus size={18} /> Add table
          </button>
        }
      />
      <ErrorBox error={error} />
      {isLoading ? (
        <Loading />
      ) : (
        <div className="admin-table-grid">
          {data
            ?.sort((a, b) => a.order - b.order)
            .map((t) => (
              <div className={`panel admin-table-card ${t.active ? '' : 'inactive'}`} key={t.id}>
                <div>
                  <strong>Table {t.number}</strong>
                  <button
                    className="icon-button"
                    onClick={() => setEditing(t)}
                    aria-label={`Edit table ${t.number}`}
                  >
                    <Pencil size={17} />
                  </button>
                </div>
                <TableDrawing capacity={t.capacity} state="available" />
                <h3>{t.area}</h3>
                <p>
                  <Users size={14} />
                  {t.capacity} seats <span>·</span>
                  {t.active ? 'Accepting reservations' : 'Inactive'}
                </p>
              </div>
            ))}
        </div>
      )}
      {editing && (
        <TableEditor
          table={editing === 'new' ? undefined : editing}
          nextOrder={data?.length ?? 0}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  );
}
function TableEditor({
  table,
  nextOrder,
  onClose,
}: {
  table?: Table;
  nextOrder: number;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    number: table?.number ?? '',
    capacity: table?.capacity ?? 2,
    area: table?.area ?? 'Main dining',
    order: table?.order ?? nextOrder,
    active: table?.active ?? true,
  });
  const mutation = useMutation({
    mutationFn: () =>
      api(`/admin/tables${table ? `/${table.id}` : ''}`, {
        method: table ? 'PUT' : 'POST',
        body: form,
      }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  return (
    <Modal
      title={table ? `Edit table ${table.number}` : 'Make room for more.'}
      subtitle="Manage capacity, location, and availability."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="form-grid">
          <label>
            Table number
            <input
              required
              maxLength={10}
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
            />
          </label>
          <label>
            Seats
            <input
              type="number"
              min="1"
              max="30"
              required
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
            />
          </label>
        </div>
        <label>
          Space
          <input
            required
            maxLength={60}
            value={form.area}
            onChange={(e) => setForm({ ...form, area: e.target.value })}
          />
        </label>
        <label>
          Display order
          <input
            type="number"
            required
            min="0"
            max="999"
            value={form.order}
            onChange={(e) => setForm({ ...form, order: Number(e.target.value) })}
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          Accept reservations for this table
        </label>
        <p className="fine-print">
          Tables with active bookings cannot be deactivated or reduced below the booked party size.
        </p>
        <ErrorBox error={mutation.error} />
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={mutation.isPending}>
            <Save size={16} /> Save table
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function SettingsPage() {
  const { settings } = useSession();
  const [form, setForm] = useState<Settings>(structuredClone(settings));
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: () => api('/admin/settings', { method: 'PUT', body: form }),
    onSuccess: () => {
      void invalidate();
      setSaved(true);
    },
  });
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setForm({ ...form, [key]: value });
    setSaved(false);
  };
  return (
    <>
      <Heading
        eyebrow="THE WAY YOU WELCOME"
        title="Restaurant settings"
        description="Set the rhythm of your dining room."
      />
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <section className="panel">
          <div className="settings-section-title">
            <span className="setting-icon">
              <Armchair size={20} />
            </span>
            <div>
              <h2>The essentials</h2>
              <p>Your restaurant and booking preferences.</p>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Restaurant name
              <input required value={form.name} onChange={(e) => set('name', e.target.value)} />
            </label>
            <label>
              Timezone
              <input
                required
                value={form.timezone}
                onChange={(e) => set('timezone', e.target.value)}
              />
            </label>
            <label>
              Sitting duration (minutes)
              <input
                type="number"
                required
                min="15"
                max="300"
                value={form.durationMinutes}
                onChange={(e) => set('durationMinutes', Number(e.target.value))}
              />
            </label>
            <label>
              Start time interval (minutes)
              <input
                type="number"
                required
                min="5"
                max="60"
                value={form.slotMinutes}
                onChange={(e) => set('slotMinutes', Number(e.target.value))}
              />
            </label>
            <label>
              Booking horizon (days)
              <input
                type="number"
                required
                min="1"
                max="365"
                value={form.horizonDays}
                onChange={(e) => set('horizonDays', Number(e.target.value))}
              />
            </label>
            <label>
              Late arrival grace (minutes)
              <input
                type="number"
                required
                min="0"
                max="120"
                value={form.graceMinutes}
                onChange={(e) => set('graceMinutes', Number(e.target.value))}
              />
            </label>
            <label>
              Reservation deposit (₹)
              <input
                type="number"
                required
                min="1"
                max="100000"
                step="1"
                value={form.depositPaise / 100}
                onChange={(e) => set('depositPaise', Math.round(Number(e.target.value) * 100))}
              />
            </label>
          </div>
          <p className="fine-print">
            Duration and deposit changes apply to new bookings. Existing bookings keep their
            original terms.
          </p>
        </section>
        <section className="panel">
          <div className="settings-section-title">
            <span className="setting-icon">
              <ClockIcon />
            </span>
            <div>
              <h2>Opening hours</h2>
              <p>Bookings must fit entirely inside service hours.</p>
            </div>
          </div>
          <div className="hours-list">
            {form.hours.map((h, i) => (
              <div key={h.day} className="hours-row">
                <strong>
                  {
                    ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
                      h.day
                    ]
                  }
                </strong>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={!h.closed}
                    onChange={(e) =>
                      set(
                        'hours',
                        form.hours.map((v, j) =>
                          j === i ? { ...v, closed: !e.target.checked } : v,
                        ),
                      )
                    }
                  />
                  {h.closed ? 'Closed' : 'Open'}
                </label>
                <input
                  type="time"
                  aria-label={`${h.day} opening time`}
                  value={h.open}
                  disabled={h.closed}
                  onChange={(e) =>
                    set(
                      'hours',
                      form.hours.map((v, j) => (j === i ? { ...v, open: e.target.value } : v)),
                    )
                  }
                />
                <span>to</span>
                <input
                  type="time"
                  aria-label={`${h.day} closing time`}
                  value={h.close}
                  disabled={h.closed}
                  onChange={(e) =>
                    set(
                      'hours',
                      form.hours.map((v, j) => (j === i ? { ...v, close: e.target.value } : v)),
                    )
                  }
                />
              </div>
            ))}
          </div>
          <label className="closure-label">
            Holiday closures <span className="muted">(one YYYY-MM-DD date per line)</span>
            <textarea
              rows={3}
              value={form.closedDates.join('\n')}
              onChange={(e) => set('closedDates', e.target.value.split('\n'))}
              onBlur={() =>
                set('closedDates', form.closedDates.map((d) => d.trim()).filter(Boolean))
              }
              placeholder="2026-12-25"
            />
          </label>
        </section>
        <ErrorBox error={mutation.error} />
        <div className="settings-save">
          {saved && (
            <span className="success-message">
              <Check size={17} /> Settings saved
            </span>
          )}
          <button className="button" disabled={mutation.isPending}>
            <Save size={17} />
            {mutation.isPending ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </>
  );
}
function ClockIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
export function TeamPage() {
  const { user } = useSession();
  const [invite, setInvite] = useState(false),
    [email, setEmail] = useState(''),
    [role, setRole] = useState('STAFF');
  const { data, error } = useQuery({
    queryKey: ['team'],
    queryFn: () => api<{ users: User[]; invites: Invite[] }>('/admin/team'),
  });
  const mutation = useMutation({
    mutationFn: () => api('/admin/invites', { method: 'POST', body: { email, role } }),
    onSuccess: () => {
      void invalidate();
      setInvite(false);
      setEmail('');
    },
  });
  const update = useMutation({
    mutationFn: ({ id, active, role }: { id: string; active: boolean; role: string }) =>
      api(`/admin/team/${id}`, { method: 'PATCH', body: { active, role } }),
    onSuccess: invalidate,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/admin/invites/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  return (
    <>
      <Heading
        eyebrow="THE PEOPLE BEHIND THE WELCOME"
        title="Your restaurant team"
        description="The right access for the people who make it happen."
        actions={
          <button className="button" onClick={() => setInvite(true)}>
            <Plus size={18} /> Invite member
          </button>
        }
      />
      <ErrorBox error={error ?? update.error ?? revoke.error} />
      <div className="panel table-overflow">
        <table className="data-table">
          <thead>
            <tr>
              <th>Team member</th>
              <th>Role</th>
              <th>Status</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {data?.users.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>
                    {u.name}
                    {u.id === user!.id && ' (you)'}
                  </strong>
                  <small>{u.email}</small>
                </td>
                <td>
                  <select
                    aria-label={`Role for ${u.name}`}
                    value={u.role}
                    disabled={u.id === user!.id || update.isPending}
                    onChange={(e) =>
                      update.mutate({ id: u.id, active: u.active, role: e.target.value })
                    }
                  >
                    <option value="ADMIN">Admin</option>
                    <option value="STAFF">Staff</option>
                  </select>
                </td>
                <td>
                  <Badge value={u.active ? 'active' : 'inactive'} />
                </td>
                <td>
                  {u.id !== user!.id && (
                    <button
                      className="text-link"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: u.id, role: u.role, active: !u.active })}
                    >
                      {u.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!data?.invites.length && (
        <section className="panel pending-invites">
          <h2>Pending invitations</h2>
          <p>Access becomes active when they sign in with this Google email.</p>
          {data.invites.map((i) => (
            <div key={i.id} className="invite-row">
              <Mail size={18} />
              <strong>{i.email}</strong>
              <Badge value={i.role} />
              <button
                aria-label={`Revoke invite for ${i.email}`}
                className="icon-button"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(i.id)}
              >
                <X size={17} />
              </button>
            </div>
          ))}
        </section>
      )}
      <div className="role-explainer">
        <div>
          <ShieldCheck size={21} />
          <strong>Administrators</strong>
          <p>Manage tables, policies, team access, refunds, and daily operations.</p>
        </div>
        <div>
          <Users size={21} />
          <strong>Restaurant staff</strong>
          <p>Welcome guests, create walk-ins, scan tickets, and manage visits.</p>
        </div>
      </div>
      {invite && (
        <Modal
          title="One more warm welcome."
          subtitle="Invite a team member using their Google account email."
          onClose={() => setInvite(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <label>
              Email address
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Access level
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="STAFF">Restaurant staff</option>
                <option value="ADMIN">Administrator</option>
              </select>
            </label>
            <ErrorBox error={mutation.error} />
            <div className="modal-actions">
              <button className="button" disabled={mutation.isPending}>
                <Plus size={17} /> Invite member
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function ActivityPage() {
  const { settings } = useSession();
  const [search, setSearch] = useState('');
  const { data, error, isLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: () => api<Audit[]>('/admin/audit'),
    refetchInterval: 30000,
  });
  const rows = data?.filter((a) =>
    `${a.action} ${a.actorName} ${a.target}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <Heading
        eyebrow="A CLEAR RECORD"
        title="Activity log"
        description="The latest 300 actions, with the who, what, and when."
      />
      <section className="panel">
        <label className="search-field audit-search">
          <Search size={17} />
          <input
            placeholder="Find an action, person, or booking"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <ErrorBox error={error} />
        {isLoading ? (
          <Loading />
        ) : rows?.length ? (
          <div className="audit-list">
            {rows.map((a) => (
              <article key={a.id}>
                <span className="audit-dot" />
                <div>
                  <strong>{a.action.replaceAll('_', ' ').toLowerCase()}</strong>
                  <p>
                    {a.actorName} <span>·</span> {a.target}
                  </p>
                  {a.detail && (
                    <details>
                      <summary>Details</summary>
                      <pre>{a.detail}</pre>
                    </details>
                  )}
                </div>
                <time>
                  {day(a.at, settings.timezone)}
                  <br />
                  {time(a.at, settings.timezone)}
                </time>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="No matching activity" />
        )}
      </section>
    </>
  );
}
type Refund = Payment & { booking: Booking };
export function RefundsPage() {
  const [selected, setSelected] = useState<{ refund: Refund; approve: boolean }>(),
    [reason, setReason] = useState('');
  const { data, error, isLoading } = useQuery({
    queryKey: ['refunds'],
    queryFn: () => api<Refund[]>('/admin/refunds'),
    refetchInterval: 15000,
  });
  const mutation = useMutation({
    mutationFn: () =>
      api(`/admin/refunds/${selected!.refund.id}`, {
        method: 'POST',
        body: { approve: selected!.approve, reason },
      }),
    onSuccess: () => {
      void invalidate();
      setSelected(undefined);
      setReason('');
    },
  });
  return (
    <>
      <Heading
        eyebrow="CARE, THROUGH EVERY DETAIL"
        title="Deposits & refunds"
        description="Review cancelled visits and keep guests informed."
      />
      <div className="refund-summary">
        <div className="panel">
          <span>Awaiting your review</span>
          <strong>{data?.filter((p) => p.refundStatus === 'REVIEW').length ?? 0}</strong>
        </div>
        <div className="panel">
          <span>Total refunded</span>
          <strong>
            {money(
              data
                ?.filter((p) => p.refundStatus === 'REFUNDED')
                .reduce((sum, p) => sum + p.amount, 0) ?? 0,
            )}
          </strong>
        </div>
      </div>
      <ErrorBox error={error} />
      <section className="panel">
        {isLoading ? (
          <Loading />
        ) : data?.length ? (
          <div className="table-overflow">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Guest / reservation</th>
                  <th>Deposit</th>
                  <th>Refund status</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.booking.guestName}</strong>
                      <small>{p.booking.code}</small>
                      {p.error && <small className="warning-text">{p.error}</small>}
                    </td>
                    <td>{money(p.amount)}</td>
                    <td>
                      <Badge value={p.refundStatus} />
                      {p.refundId && <small>{p.refundId}</small>}
                    </td>
                    <td>
                      {p.refundStatus === 'REVIEW' ? (
                        <div className="inline-actions">
                          <button
                            className="button small"
                            onClick={() => setSelected({ refund: p, approve: true })}
                          >
                            Approve
                          </button>
                          <button
                            className="button secondary small"
                            onClick={() => setSelected({ refund: p, approve: false })}
                          >
                            Decline
                          </button>
                        </div>
                      ) : (
                        <span className="muted">{p.refundReason || '—'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nothing to review">
            Cancelled paid bookings and no-shows will appear here.
          </Empty>
        )}
      </section>
      <p className="fine-print">
        Approved refunds run in the background. Pending status remains until the payment provider
        confirms processing. A failed or uncertain refund needs provider reconciliation; it is never
        automatically charged again.
      </p>
      {selected && (
        <Modal
          title={selected.approve ? 'Approve the full refund?' : 'Decline this refund?'}
          subtitle={`${selected.refund.booking.guestName} · ${money(selected.refund.amount)}`}
          onClose={() => setSelected(undefined)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <label>
              Reason shared with the guest
              <textarea
                required
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Let the guest know the reason for your decision."
              />
            </label>
            <ErrorBox error={mutation.error} />
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setSelected(undefined)}
              >
                Go back
              </button>
              <button className="button" disabled={mutation.isPending}>
                Confirm decision
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
