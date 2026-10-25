import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import MongoSession from 'connect-mongo';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { OAuth2Client } from 'google-auth-library';
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { z, ZodError } from 'zod';
import type { Role, User } from '../shared/types.js';
import { config } from './config.js';
import {
  AppError,
  assert,
  audit,
  createBooking,
  expireHolds,
  id,
  isFree,
  slotsForDate,
  tableView,
  viewBooking,
  activeStatuses,
} from './domain.js';
import { validSignature } from './gateway.js';
import type { BookingService } from './service.js';
import { bookingInput, settingsInput, tableInput, walkInInput } from './validation.js';
import { verifyPassword } from './passwords.js';

declare module 'express-session' {
  interface SessionData {
    userId: string;
    csrf: string;
    oauthState: string;
    oauthNonce: string;
    oauthVerifier: string;
  }
}
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const regenerate = (req: Request) =>
  new Promise<void>((resolve, reject) =>
    req.session.regenerate((e) => (e ? reject(e) : resolve())),
  );
const save = (req: Request) =>
  new Promise<void>((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
const protect =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError(401, 'Please sign in to continue.'));
    if (roles.length && !roles.includes(req.user.role))
      return next(new AppError(403, 'You do not have access to this action.'));
    next();
  };

export function createApp(service: BookingService) {
  const app = express(),
    store = service.store;
  app.disable('x-powered-by');
  if (config.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https://*.razorpay.com'],
          connectSrc: [
            "'self'",
            'https://*.razorpay.com',
            ...(config.NODE_ENV !== 'production' ? ['ws://localhost:*', 'ws://127.0.0.1:*'] : []),
          ],
          frameSrc: ['https://*.razorpay.com'],
          workerSrc: ["'self'", 'blob:'],
          upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null,
        },
      },
    }),
  );
  app.get('/api/health', async (_req, res) => {
    await store.read();
    res.json({ status: 'ok', mode: config.APP_MODE, storage: store.kind });
  });
  // Raw body must be verified before JSON parsing; webhook calls have no browser session.
  app.post(
    '/api/v1/payments/webhook',
    express.raw({ type: 'application/json', limit: '256kb' }),
    async (req, res) => {
      assert(!service.demo, 404, 'Live webhooks are disabled in demo mode.');
      assert(
        Buffer.isBuffer(req.body) &&
          validSignature(
            req.body,
            req.get('x-razorpay-signature'),
            config.RAZORPAY_WEBHOOK_SECRET!,
          ),
        401,
        'Invalid webhook signature.',
      );
      const event = JSON.parse(req.body.toString());
      const eventId = req.get('x-razorpay-event-id');
      assert(eventId, 400, 'Missing webhook event ID.');
      if (event.event === 'payment.captured') {
        const payment = z
          .object({
            id: z.string(),
            order_id: z.string(),
            amount: z.number().int(),
            currency: z.string(),
          })
          .parse(event.payload?.payment?.entity);
        await service.captured(eventId, payment);
      } else if (['refund.processed', 'refund.failed'].includes(event.event)) {
        const refund = z
          .object({
            id: z.string(),
            payment_id: z.string(),
            amount: z.number().int(),
            status: z.string(),
          })
          .parse(event.payload?.refund?.entity);
        await service.refunded(eventId, refund, event.event === 'refund.failed');
      }
      res.json({ received: true });
    },
  );
  app.use(express.json({ limit: '32kb' }));
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 180,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Please wait a minute.' },
    }),
  );
  app.use(
    session({
      name: 'lopez.sid',
      secret: config.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store:
        store.kind === 'memory'
          ? undefined
          : MongoSession.create({ mongoUrl: config.MONGODB_URI!, collectionName: 'sessions' }),
      cookie: {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 12,
      },
    }),
  );
  app.use('/api/v1', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.session.userId)
      req.user = (await store.read()).users.find((u) => u.id === req.session.userId && u.active);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      assert(
        !origin || origin === new URL(config.APP_URL).origin,
        403,
        'Request origin is not allowed.',
      );
      assert(
        req.session.csrf && req.get('x-csrf-token') === req.session.csrf,
        403,
        'Your session expired. Refresh the page and try again.',
      );
    }
    next();
  });
  app.get('/api/v1/session', async (req, res) => {
    req.session.csrf ??= randomBytes(24).toString('hex');
    res.json({
      user: req.user ?? null,
      csrf: req.session.csrf,
      mode: service.demo ? 'demo' : 'live',
      storage: store.kind,
      settings: (await store.read()).settings[0],
    });
  });
  app.post(
    ['/api/v1/auth/login', '/api/v1/auth/demo'],
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 30,
      skipSuccessfulRequests: true,
      message: { error: 'Too many sign-in attempts. Please try again in 15 minutes.' },
    }),
    async (req, res) => {
      assert(service.demo && config.NODE_ENV !== 'production', 404, 'Demo sign-in is disabled.');
      const input = z
        .object({ email: z.email().max(254), password: z.string().min(1).max(128) })
        .parse(req.body);
      const state = await store.read();
      const user = state.users.find((u) => u.email === input.email.trim().toLowerCase());
      const credential = state.credentials.find((c) => c.userId === user?.id);
      const valid = await verifyPassword(input.password, credential);
      assert(valid && user?.active, 401, 'Invalid email or password.');
      await store.transaction((s) =>
        audit(s, user, 'SIGNED_IN', user.id, 'Development password sign-in'),
      );
      await regenerate(req);
      req.session.userId = user.id;
      req.session.csrf = randomBytes(24).toString('hex');
      await save(req);
      res.json({ user });
    },
  );
  app.post('/api/v1/auth/logout', protect(), async (req, res) => {
    await new Promise<void>((resolve, reject) =>
      req.session.destroy((e) => (e ? reject(e) : resolve())),
    );
    res.clearCookie('lopez.sid');
    res.json({ ok: true });
  });
  const oauth = new OAuth2Client(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    `${config.APP_URL}/api/v1/auth/google/callback`,
  );
  app.get('/api/v1/auth/google', async (req, res) => {
    assert(!service.demo, 400, 'Use a demo account in demo mode.');
    req.session.oauthState = randomBytes(32).toString('hex');
    req.session.oauthNonce = randomBytes(32).toString('hex');
    const codes = await oauth.generateCodeVerifierAsync();
    req.session.oauthVerifier = codes.codeVerifier;
    await save(req);
    res.redirect(
      oauth.generateAuthUrl({
        scope: ['openid', 'email', 'profile'],
        state: req.session.oauthState,
        nonce: req.session.oauthNonce,
        code_challenge: codes.codeChallenge,
        code_challenge_method: 'S256' as never,
        prompt: 'select_account',
      }),
    );
  });
  app.get('/api/v1/auth/google/callback', async (req, res) => {
    assert(!service.demo, 404, 'Google sign-in is disabled in demo mode.');
    assert(
      typeof req.query.state === 'string' &&
        req.query.state === req.session.oauthState &&
        req.session.oauthVerifier,
      400,
      'Google sign-in session expired. Please try again.',
    );
    assert(typeof req.query.code === 'string', 400, 'Google sign-in was not completed.');
    const nonce = req.session.oauthNonce,
      verifier = req.session.oauthVerifier;
    delete req.session.oauthState;
    delete req.session.oauthNonce;
    delete req.session.oauthVerifier;
    await save(req);
    const { tokens } = await oauth.getToken({ code: req.query.code, codeVerifier: verifier });
    assert(tokens.id_token, 400, 'Google did not return an identity token.');
    const identity = await oauth.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.GOOGLE_CLIENT_ID,
    });
    const profile = identity.getPayload();
    assert(
      profile &&
        profile.email &&
        profile.email_verified &&
        (profile as typeof profile & { nonce?: string }).nonce === nonce,
      401,
      'Google identity could not be verified.',
    );
    const email = profile.email.toLowerCase();
    const user = await store.transaction((s) => {
      let user = s.users.find((u) => u.googleId === profile.sub || u.email === email);
      if (!user) {
        const invite = s.invites.find((i) => i.email === email);
        const bootstrap = config.ADMIN_EMAILS.toLowerCase()
          .split(',')
          .map((e) => e.trim())
          .includes(email);
        user = {
          id: id(),
          googleId: profile.sub,
          email,
          name: profile.name ?? email,
          role: invite?.role ?? (bootstrap ? 'ADMIN' : 'CUSTOMER'),
          active: true,
        };
        s.users.push(user);
        s.invites = s.invites.filter((i) => i.email !== email);
        audit(s, user, 'ACCOUNT_CREATED', email, user.role);
      }
      assert(user.active, 403, 'This account has been deactivated.');
      assert(
        !user.googleId || user.googleId === profile.sub,
        401,
        'This email is linked to another identity.',
      );
      user.googleId = profile.sub;
      return user;
    });
    await regenerate(req);
    req.session.userId = user.id;
    req.session.csrf = randomBytes(24).toString('hex');
    await save(req);
    res.redirect(user.role === 'CUSTOMER' ? '/book' : '/');
  });
  app.get('/api/v1/availability', async (req, res) => {
    const { date, partySize, start } = z
      .object({
        date: z.string(),
        partySize: z.coerce.number().int().min(1).max(30),
        start: z.iso.datetime({ offset: true }).optional(),
      })
      .parse(req.query);
    const s = await store.read(),
      now = new Date();
    const slots = slotsForDate(s.settings[0], date, now);
    if (start) assert(slots.includes(start), 400, 'This start time is unavailable.');
    const time = start ?? slots[0];
    const end = time
      ? new Date(Date.parse(time) + s.settings[0].durationMinutes * 60000).toISOString()
      : null;
    const tables = s.tables
      .filter((t) => t.active)
      .sort((a, b) => a.order - b.order)
      .map((t) => ({
        ...t,
        available: !!time && t.capacity >= partySize && isFree(s, t.id, time, end!, now),
      }));
    res.json({ slots, start: time, end, tables, settings: s.settings[0] });
  });
  app.get('/api/v1/bookings', protect(), async (req, res) => {
    const s = await store.read();
    res.json(
      s.bookings
        .filter((b) => req.user!.role !== 'CUSTOMER' || b.userId === req.user!.id)
        .map((b) => viewBooking(s, b, service.secret))
        .sort((a, b) => b.start.localeCompare(a.start)),
    );
  });
  app.get('/api/v1/bookings/:id', protect(), async (req, res) =>
    res.json(await service.get(String(req.params.id), req.user!)),
  );
  app.post(
    '/api/v1/bookings',
    protect(),
    rateLimit({ windowMs: 60000, limit: 10 }),
    async (req, res) =>
      res.status(201).json(await service.hold(req.user!, bookingInput.parse(req.body))),
  );
  app.post('/api/v1/bookings/:id/actions', protect(), async (req, res) => {
    const { action } = z
      .object({ action: z.enum(['cancel', 'check-in', 'complete', 'no-show']) })
      .parse(req.body);
    res.json(await service.action(String(req.params.id), req.user!, action));
  });
  app.get('/api/v1/checkout/:id', protect(), async (req, res) => {
    const b = await service.get(String(req.params.id), req.user!);
    assert(
      b.status === 'PAYMENT_PENDING' && Date.parse(b.holdUntil!) > Date.now(),
      409,
      'This checkout has ended.',
    );
    res.json({
      key: config.RAZORPAY_KEY_ID,
      orderId: b.payment?.orderId,
      amount: b.depositPaise,
      currency: 'INR',
      demo: service.demo,
    });
  });
  app.post('/api/v1/checkout/:id/demo-pay', protect(), async (req, res) => {
    assert(service.demo, 404, 'Demo payment is disabled.');
    const b = await service.get(String(req.params.id), req.user!);
    assert(b.status === 'PAYMENT_PENDING' && b.payment?.orderId, 409, 'Checkout is not pending.');
    await service.captured(`demo:${b.id}`, {
      id: `pay_demo_${b.id}`,
      order_id: b.payment.orderId,
      amount: b.depositPaise,
      currency: 'INR',
    });
    res.json(await service.get(b.id, req.user!));
  });
  app.get('/api/v1/notifications', protect(), async (req, res) =>
    res.json(
      (await store.read()).notifications
        .filter((n) => n.userId === req.user!.id)
        .sort((a, b) => b.at.localeCompare(a.at)),
    ),
  );
  app.get('/api/v1/staff/dashboard', protect('STAFF', 'ADMIN'), async (req, res) => {
    const s = await store.read(),
      now = new Date();
    const date =
      typeof req.query.date === 'string'
        ? req.query.date
        : DateTime.fromJSDate(now).setZone(s.settings[0].timezone).toISODate()!;
    assert(DateTime.fromISO(date).isValid, 400, 'Invalid date.');
    const today = DateTime.fromJSDate(now).setZone(s.settings[0].timezone).toISODate();
    const at =
      date === today
        ? now
        : DateTime.fromISO(`${date}T12:00`, { zone: s.settings[0].timezone }).toJSDate();
    res.json({
      tables: s.tables.sort((a, b) => a.order - b.order).map((t) => tableView(s, t, at)),
      bookings: s.bookings
        .filter(
          (b) => DateTime.fromISO(b.start).setZone(s.settings[0].timezone).toISODate() === date,
        )
        .map((b) => viewBooking(s, b, service.secret))
        .sort((a, b) => a.start.localeCompare(b.start)),
      settings: s.settings[0],
      serverTime: now.toISOString(),
    });
  });
  app.post('/api/v1/staff/walk-ins', protect('STAFF', 'ADMIN'), async (req, res) => {
    const input = walkInInput.parse({
      ...req.body,
      start: new Date(Math.floor(Date.now() / 60000) * 60000).toISOString(),
    });
    const b = await store.transaction((s) =>
      createBooking(s, req.user!, input, service.secret, true),
    );
    res.status(201).json(await service.get(b.id, req.user!));
  });
  app.post('/api/v1/staff/ticket-lookup', protect('STAFF', 'ADMIN'), async (req, res) => {
    const { value } = z.object({ value: z.string().trim().min(1).max(300) }).parse(req.body);
    res.json(await service.lookup(value));
  });
  app.get('/api/v1/admin/tables', protect('ADMIN'), async (_req, res) =>
    res.json((await store.read()).tables),
  );
  app.post('/api/v1/admin/tables', protect('ADMIN'), async (req, res) => {
    const input = tableInput.parse(req.body);
    const table = await store.transaction((s) => {
      assert(
        !s.tables.some((t) => t.number === input.number),
        409,
        'That table number already exists.',
      );
      const table = { ...input, id: id() };
      s.tables.push(table);
      audit(s, req.user!, 'TABLE_CREATED', input.number, JSON.stringify(input));
      return table;
    });
    res.status(201).json(table);
  });
  app.put('/api/v1/admin/tables/:id', protect('ADMIN'), async (req, res) => {
    const input = tableInput.parse(req.body);
    res.json(
      await store.transaction((s) => {
        const table = s.tables.find((t) => t.id === req.params.id);
        assert(table, 404, 'Table not found.');
        assert(
          !s.tables.some((t) => t.id !== table.id && t.number === input.number),
          409,
          'That table number already exists.',
        );
        const active = s.bookings.filter(
          (b) =>
            b.tableId === table.id &&
            activeStatuses.includes(b.status) &&
            (Date.parse(b.end) > Date.now() || b.status === 'CHECKED_IN'),
        );
        assert(
          !active.length || (input.active && active.every((b) => b.partySize <= input.capacity)),
          409,
          'Existing bookings prevent deactivation or reducing capacity.',
        );
        const before = JSON.stringify(table);
        Object.assign(table, input);
        audit(s, req.user!, 'TABLE_UPDATED', table.number, `${before} → ${JSON.stringify(table)}`);
        return table;
      }),
    );
  });
  app.put('/api/v1/admin/settings', protect('ADMIN'), async (req, res) => {
    const input = settingsInput.parse(req.body);
    res.json(
      await store.transaction((s) => {
        const future = s.bookings.filter(
          (b) => activeStatuses.includes(b.status) && Date.parse(b.end) > Date.now(),
        );
        assert(
          !future.length || input.timezone === s.settings[0].timezone,
          409,
          'Timezone cannot change while there are active bookings.',
        );
        for (const b of future) {
          const start = DateTime.fromISO(b.start).setZone(input.timezone),
            end = DateTime.fromISO(b.end).setZone(input.timezone);
          const hours = input.hours.find((h) => h.day === start.weekday % 7)!;
          assert(
            !input.closedDates.includes(start.toISODate()!) &&
              !hours.closed &&
              start.toFormat('HH:mm') >= hours.open &&
              end.toFormat('HH:mm') <= hours.close,
            409,
            `New opening hours conflict with booking ${b.code}. Resolve that booking first.`,
          );
        }
        const before = JSON.stringify(s.settings[0]);
        s.settings[0] = { id: 'restaurant', ...input };
        audit(
          s,
          req.user!,
          'SETTINGS_UPDATED',
          'Restaurant',
          `${before} → ${JSON.stringify(input)}`,
        );
        return s.settings[0];
      }),
    );
  });
  app.get('/api/v1/admin/team', protect('ADMIN'), async (_req, res) => {
    const s = await store.read();
    res.json({ users: s.users.filter((u) => u.role !== 'CUSTOMER'), invites: s.invites });
  });
  app.post('/api/v1/admin/invites', protect('ADMIN'), async (req, res) => {
    const input = z.object({ email: z.email(), role: z.enum(['STAFF', 'ADMIN']) }).parse(req.body);
    input.email = input.email.toLowerCase();
    await store.transaction((s) => {
      const user = s.users.find((u) => u.email === input.email);
      assert(!user || user.role === 'CUSTOMER', 409, 'This person already has a staff account.');
      if (user) user.role = input.role;
      else {
        s.invites = s.invites.filter((i) => i.email !== input.email);
        s.invites.push({ id: id(), ...input });
      }
      audit(s, req.user!, 'STAFF_INVITED', input.email, input.role);
      s.notifications.push({
        id: id(),
        email: input.email,
        userId: user?.id,
        subject: 'You’re invited to the Lopez team',
        body: `You have been invited as ${input.role.toLowerCase()}. Sign in with this Google email at ${config.APP_URL}.`,
        at: new Date().toISOString(),
        sent: false,
        attempts: 0,
      });
    });
    res.json({ ok: true });
  });
  app.delete('/api/v1/admin/invites/:id', protect('ADMIN'), async (req, res) => {
    await store.transaction((s) => {
      const invite = s.invites.find((i) => i.id === req.params.id);
      assert(invite, 404, 'Invitation not found.');
      s.invites = s.invites.filter((i) => i.id !== invite.id);
      audit(s, req.user!, 'INVITE_REVOKED', invite.email);
    });
    res.json({ ok: true });
  });
  app.patch('/api/v1/admin/team/:id', protect('ADMIN'), async (req, res) => {
    const input = z
      .object({ active: z.boolean(), role: z.enum(['STAFF', 'ADMIN']) })
      .parse(req.body);
    await store.transaction((s) => {
      const user = s.users.find((u) => u.id === req.params.id);
      assert(user, 404, 'User not found.');
      assert(user.id !== req.user!.id, 400, 'You cannot change your own access.');
      assert(
        user.role !== 'ADMIN' ||
          (input.active && input.role === 'ADMIN') ||
          s.users.some((u) => u.id !== user.id && u.role === 'ADMIN' && u.active),
        409,
        'Keep at least one active administrator.',
      );
      Object.assign(user, input);
      audit(s, req.user!, 'STAFF_ACCESS_UPDATED', user.email, JSON.stringify(input));
    });
    res.json({ ok: true });
  });
  app.get('/api/v1/admin/refunds', protect('ADMIN'), async (_req, res) => {
    const s = await store.read();
    res.json(
      s.payments
        .filter((p) => p.refundStatus !== 'NONE')
        .map((p) => ({ ...p, booking: s.bookings.find((b) => b.id === p.bookingId) })),
    );
  });
  app.post('/api/v1/admin/refunds/:id', protect('ADMIN'), async (req, res) => {
    const { approve, reason } = z
      .object({ approve: z.boolean(), reason: z.string().trim().min(3).max(500) })
      .parse(req.body);
    await service.refundDecision(String(req.params.id), req.user!, approve, reason);
    res.json({ ok: true });
  });
  app.get('/api/v1/admin/audit', protect('ADMIN'), async (_req, res) =>
    res.json((await store.read()).audits.slice(-300).reverse()),
  );
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'Endpoint not found.')));
  const web = path.resolve('dist');
  if (existsSync(web)) {
    app.use(express.static(web));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(web, 'index.html')));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError)
      return res
        .status(400)
        .json({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    if (error instanceof AppError) return res.status(error.status).json({ error: error.message });
    if (error instanceof SyntaxError)
      return res.status(400).json({ error: 'Invalid JSON request.' });
    console.error('Request failed:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}
