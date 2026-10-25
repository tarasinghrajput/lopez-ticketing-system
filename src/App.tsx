import { createContext, useContext, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import {
  Armchair,
  CalendarDays,
  LayoutDashboard,
  Settings2,
  Users,
  ReceiptText,
  History,
  LogOut,
  ArrowUpRight,
  Menu,
  X,
  Bell,
  ChevronDown,
  Utensils,
  Globe,
  ShieldCheck,
} from 'lucide-react';
import type { SessionResponse, Role, Notification } from '../shared/types';
import { api, queryClient, setCsrf } from './api';
import { ErrorBox, Loading } from './ui';
import { DashboardPage, ReservationsPage, TicketPage, WalkInModal } from './operations';
import { BookPage, MyBookingsPage } from './customer';
import { TablesPage, SettingsPage, TeamPage, ActivityPage, RefundsPage } from './admin';
import { demoAccounts } from '../shared/demo-accounts';

const SessionContext = createContext<SessionResponse>(null!);
export const useSession = () => useContext(SessionContext);
export function App() {
  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const s = await api<SessionResponse>('/session');
      setCsrf(s.csrf);
      return s;
    },
    staleTime: 60000,
  });
  if (session.isLoading) return <Loading />;
  if (session.error)
    return (
      <main className="startup-error">
        <h1>We couldn’t connect.</h1>
        <ErrorBox error={session.error} />
        <button className="button" onClick={() => session.refetch()}>
          Try again
        </button>
      </main>
    );
  const s = session.data!;
  return (
    <SessionContext.Provider value={s}>
      <Routes>
        <Route
          path="/login"
          element={
            s.user ? (
              <Navigate to={s.user.role === 'CUSTOMER' ? '/book' : '/'} replace />
            ) : (
              <Login />
            )
          }
        />
        <Route element={s.user ? <Shell /> : <Navigate to="/login" replace />}>
          <Route
            index
            element={
              s.user?.role === 'CUSTOMER' ? <Navigate to="/book" replace /> : <DashboardPage />
            }
          />
          <Route path="book" element={<BookPage />} />
          <Route path="my-bookings" element={<MyBookingsPage />} />
          <Route path="ticket/:id" element={<TicketPage />} />
          <Route element={<RoleGuard roles={['STAFF', 'ADMIN']} />}>
            <Route path="reservations" element={<ReservationsPage />} />
          </Route>
          <Route element={<RoleGuard roles={['ADMIN']} />}>
            <Route path="tables" element={<TablesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="activity" element={<ActivityPage />} />
            <Route path="refunds" element={<RefundsPage />} />
          </Route>
          <Route
            path="*"
            element={
              <div className="empty">
                <h1>Page not found</h1>
                <NavLink to="/">Back to the restaurant</NavLink>
              </div>
            }
          />
        </Route>
      </Routes>
    </SessionContext.Provider>
  );
}
function RoleGuard({ roles }: { roles: Role[] }) {
  const { user } = useSession();
  return roles.includes(user!.role) ? <Outlet /> : <Navigate to="/" replace />;
}
function Login() {
  const { mode, storage } = useSession();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role>('ADMIN');
  const [email, setEmail] = useState<string>(demoAccounts.ADMIN.email);
  const [password, setPassword] = useState<string>(demoAccounts.ADMIN.password);
  function selectAccount(role: Role) {
    setSelectedRole(role);
    setEmail(demoAccounts[role].email);
    setPassword(demoAccounts[role].password);
    setError(undefined);
  }
  async function signIn() {
    setBusy(true);
    setError(undefined);
    try {
      await api('/auth/login', { method: 'POST', body: { email: email.trim(), password } });
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-story">
        <Brand />
        <div>
          <span className="eyebrow">GOOD FOOD. GREAT COMPANY.</span>
          <h1>
            There’s a place
            <br />
            for everyone.
          </h1>
          <p>
            A thoughtfully set table. A warm welcome.
            <br />
            Your next great evening starts here.
          </p>
          <div className="login-illustration">
            <TableScene />
          </div>
        </div>
        <span className="story-footer">A LITTLE MORE HOSPITALITY. A LITTLE LESS PAPERWORK.</span>
      </div>
      <div className="login-form">
        <div className="welcome-mark">
          <Utensils size={25} />
        </div>
        <span className="eyebrow">WELCOME TO LOPEZ</span>
        <h2>Make yourself at home.</h2>
        <p>
          Reserve your favorite table, or manage a dining room
          <br className="desktop-only" /> full of good moments.
        </p>
        <ErrorBox error={error} />
        {mode === 'demo' ? (
          <>
            <div className="demo-account-picker" aria-label="Prefill a test account">
              {(['ADMIN', 'STAFF', 'CUSTOMER'] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  aria-pressed={selectedRole === role}
                  className={selectedRole === role ? 'selected' : ''}
                  disabled={busy}
                  onClick={() => selectAccount(role)}
                >
                  {role === 'CUSTOMER' ? 'Guest' : role === 'ADMIN' ? 'Admin' : 'Staff'}
                </button>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void signIn();
              }}
            >
              <label>
                Email address
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <p className="demo-password-hint">
                Test password: <code>{demoAccounts[selectedRole].password}</code>
              </p>
              <button className="button full" disabled={busy} type="submit">
                {busy ? 'Signing in…' : 'Sign in to demo'} <ArrowUpRight size={18} />
              </button>
            </form>
            <div className="demo-notice">
              <ShieldCheck size={18} />
              <span>
                Test credentials are prefilled. Payments are simulated.
                <br />
                {storage === 'mongodb'
                  ? 'MongoDB connected · data is saved between restarts.'
                  : 'In-memory mode · data resets on restart.'}
              </span>
            </div>
          </>
        ) : (
          <a className="button full google-button" href="/api/v1/auth/google">
            <span className="google-g">G</span> Continue with Google <ArrowUpRight size={18} />
          </a>
        )}
        <div className="login-footer">Your table. Your time. All in one place.</div>
      </div>
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Utensils size={22} />
      </span>
      <div>
        <span className="brand-name">
          lopez<span>.</span>
        </span>
        <span className="brand-caption">TABLE & TICKET</span>
      </div>
    </div>
  );
}
function TableScene() {
  return (
    <svg viewBox="0 0 460 250" aria-hidden="true">
      <ellipse cx="230" cy="223" rx="150" ry="15" fill="#000" opacity=".08" />
      <path
        d="M105 129v81M355 129v81M140 145v73M320 145v73"
        stroke="#d8b895"
        strokeWidth="12"
        strokeLinecap="round"
      />
      <ellipse cx="230" cy="122" rx="160" ry="62" fill="#e7cba8" />
      <ellipse cx="230" cy="115" rx="160" ry="62" fill="#f5e5ce" />
      <ellipse cx="145" cy="117" rx="33" ry="19" fill="#fffaf2" />
      <ellipse cx="315" cy="117" rx="33" ry="19" fill="#fffaf2" />
      <ellipse cx="145" cy="117" rx="24" ry="13" fill="none" stroke="#d4bfa2" />
      <ellipse cx="315" cy="117" rx="24" ry="13" fill="none" stroke="#d4bfa2" />
      <path d="M220 101l-5-25h30l-5 25z" fill="#a24832" />
      <path
        d="M230 76V38M230 59q-28 0-22-19 22 0 22 19M230 49q24 0 23-20-24 1-23 20"
        stroke="#667659"
        strokeWidth="3"
        fill="#667659"
      />
      <path d="M187 113v25M273 113v25" stroke="#b79c7b" strokeWidth="3" strokeLinecap="round" />
      <path d="M177 85l3 15h10l3-15zM267 85l3 15h10l3-15z" fill="#c9d7cf" opacity=".8" />
    </svg>
  );
}
function Shell() {
  const { user, mode, settings } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false),
    [walkIn, setWalkIn] = useState(false),
    [notifications, setNotifications] = useState(false),
    [logoutError, setLogoutError] = useState<unknown>();
  const notes = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Notification[]>('/notifications'),
    refetchInterval: 30000,
  });
  const customer = user!.role === 'CUSTOMER';
  const links = customer
    ? [
        { to: '/book', label: 'Find a table', icon: Armchair },
        { to: '/my-bookings', label: 'My bookings', icon: CalendarDays },
      ]
    : [
        { to: '/', label: 'Overview', icon: LayoutDashboard },
        { to: '/reservations', label: 'Reservations', icon: CalendarDays },
        ...(user!.role === 'ADMIN'
          ? [
              { to: '/tables', label: 'Tables & spaces', icon: Armchair },
              { to: '/refunds', label: 'Deposits & refunds', icon: ReceiptText },
            ]
          : []),
      ];
  const manage = [
    { to: '/team', label: 'Team members', icon: Users },
    { to: '/activity', label: 'Activity log', icon: History },
    { to: '/settings', label: 'Settings', icon: Settings2 },
  ];
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      navigate('/login');
    } catch (e) {
      setLogoutError(e);
    }
  }
  return (
    <div className="app-shell">
      {menu && (
        <button
          className="mobile-overlay"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <Brand />
        <div className="restaurant-selector">
          <div className="restaurant-avatar">L</div>
          <div>
            <strong>{settings.name} Restaurant</strong>
            <span>Single location · India</span>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-caption">{customer ? 'YOUR NEXT VISIT' : 'RESTAURANT'}</div>
        <nav aria-label="Main navigation">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end onClick={() => setMenu(false)}>
              <Icon size={19} />
              <span>{label}</span>
              {to === '/' && <span className="nav-dot" />}
            </NavLink>
          ))}
        </nav>
        {user!.role === 'ADMIN' && (
          <>
            <div className="nav-caption manage-label">MANAGE</div>
            <nav aria-label="Administration">
              {manage.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} onClick={() => setMenu(false)}>
                  <Icon size={18} />
                  {label}
                </NavLink>
              ))}
            </nav>
          </>
        )}
        <div className="sidebar-bottom">
          {!customer && (
            <NavLink className="guest-view" to="/book">
              <Globe size={17} /> Guest booking view <ArrowUpRight size={15} />
            </NavLink>
          )}
          <div className="sidebar-note">
            <span className="tiny-flower">✳</span>
            <strong>A seat for every story.</strong>
            <p>
              Make room for the moments
              <br />
              that bring people together.
            </p>
          </div>
          <div className="profile">
            <div className="avatar">
              {user!.name
                .split(' ')
                .map((w) => w[0])
                .slice(0, 2)
                .join('')}
            </div>
            <div>
              <strong>{user!.name}</strong>
              <span>
                {user!.role === 'ADMIN'
                  ? 'Restaurant admin'
                  : customer
                    ? 'Our guest'
                    : 'Restaurant team'}
              </span>
            </div>
            <button onClick={logout} className="icon-button" aria-label="Sign out">
              <LogOut size={17} />
            </button>
          </div>
          <ErrorBox error={logoutError} />
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button menu-button"
              onClick={() => setMenu(true)}
              aria-label="Open navigation"
            >
              <Menu size={22} />
            </button>
            <span>{customer ? 'Your visit' : 'Workspace'}</span>
            <span className="breadcrumb-slash">/</span>
            <strong>
              {[...links, ...manage].find((l) => l.to === location.pathname)?.label ??
                'Reservation details'}
            </strong>
          </div>
          <div className="topbar-right">
            <span className={`live-pill ${mode === 'demo' ? 'demo' : ''}`}>
              <i />
              {mode === 'demo' ? 'Demo workspace' : 'Live workspace'}
            </span>
            <button
              className="icon-button notification-button"
              aria-label="Notifications"
              aria-expanded={notifications}
              onClick={() => setNotifications(!notifications)}
            >
              <Bell size={19} />
              {!!notes.data?.length && <i />}
            </button>
            <div className="topbar-avatar">{user!.name[0]}</div>
          </div>
        </header>
        {notifications && (
          <div className="notification-panel">
            <header>
              <h3>Your updates</h3>
              <button
                className="icon-button"
                aria-label="Close notifications"
                onClick={() => setNotifications(false)}
              >
                <X size={18} />
              </button>
            </header>
            {notes.data?.length ? (
              notes.data.slice(0, 12).map((n) => (
                <article key={n.id}>
                  <strong>{n.subject}</strong>
                  <p>{n.body}</p>
                </article>
              ))
            ) : (
              <p>No updates yet. Reservation updates will appear here.</p>
            )}
          </div>
        )}
        <main className="main-content">
          <Outlet context={{ openWalkIn: () => setWalkIn(true) }} />
        </main>
        <footer className="app-footer">
          <span>Lopez · Table & Ticket</span>
          <span>Made for a warmer welcome.</span>
        </footer>
      </div>
      {walkIn && <WalkInModal onClose={() => setWalkIn(false)} />}
    </div>
  );
}
