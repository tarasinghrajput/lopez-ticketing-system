# Lopez · Table & Ticket

A restaurant table reservation and digital ticket system built with React, Express, Node.js, and MongoDB. Includes a responsive customer experience and a staff/admin dashboard.

## Start locally

Requires Node.js 22 or newer.

```sh
npm install
npm run dev
```

Open **http://localhost:5173**. Choose Admin, Staff, or Guest on the welcome screen, then select **Sign in to demo**. Both email and password are prefilled. The API runs on port 4000.

The supplied `.env` enables persistent MongoDB with simulated payments and email. For a new checkout, copy `.env.example` to `.env` before starting. `npm run dev` starts a real MongoDB replica set on **127.0.0.1:27018**, followed by the API and React app. The first launch may download the MongoDB binary. The development launcher uses WiredTiger with an explicit database directory and disables cleanup, so data remains in `.data/mongodb` after shutdown. [MongoDB launcher options](https://typegoose.github.io/mongodb-memory-server/versions/10.x/docs/api/interfaces/mongo-memory-instance-opts/).

| Test role | Email | Password |
| --- | --- | --- |
| Admin | `admin@lopez.test` | `LopezAdmin123!` |
| Staff | `staff@lopez.test` | `LopezStaff123!` |
| Guest | `guest@lopez.test` | `LopezGuest123!` |

These are public development fixtures, not production accounts. The backend verifies salted scrypt password hashes stored in a separate credentials collection; roles come from the database, never the login request. Account seeding is idempotent and preserves existing data and disabled access. Demo password sign-in is disabled in live mode and production rejects demo mode entirely.

MongoDB stores bookings, tables, users, password hashes, sessions, settings, audit events, and notifications. The local database is unauthenticated and bound to loopback only; the accounts above are **application logins**, not database users. In MongoDB Compass, use `mongodb://127.0.0.1:27018/lopez?replicaSet=lopez-rs`. The project does not modify any MongoDB service on port 27017.

Demo mode never charges money or sends email. Switch accounts using the sign-out button at the bottom of the sidebar. On a phone, open the navigation menu first. To use the original disposable in-memory demo, run `npm run dev:memory`. Stop the currently running dev stack before switching modes.

## Included workflows

- **Guests:** Google sign-in in live mode, date/time/party search, exact table selection, ten-minute checkout hold, Razorpay deposit, QR ticket, printable ticket, booking history, cancellation, and email/in-app updates.
- **Staff:** table overview, status filters, guest search, reservation history, QR camera or code lookup, check-in, visit completion, no-shows, and deposit-free walk-ins.
- **Admins:** table number/capacity/area/order/activation, weekly opening hours and closures, duration/deposit policies, staff invitations/access, full refund approval or rejection, and audit history.

The restaurant defaults to India time, 11:00–23:00 daily, 90-minute visits, starts every 15 minutes, a ₹500 deposit, a 30-day booking horizon, and a 15-minute late-arrival grace period. Change these in Settings. Walk-ins must fit before closing and before the next reservation; existing occupants must be completed explicitly.

## Live integration setup

For live services, set `APP_MODE=live`, `DATA_STORE=mongodb`, and `LOCAL_MONGODB=false`; replace the local URI and both demo secrets, and fill in the integration credentials below. Use a separate database for production so demo accounts and reservations are not carried over. Keep `.env` and `.data/` out of source control.

| Setting                                    | Configuration                                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`                              | MongoDB Atlas URI, or a local MongoDB replica set. Standalone MongoDB cannot support the required transactions.                               |
| `APP_URL`                                  | The browser origin. Use `http://localhost:5173` during development, or your HTTPS origin in production.                                       |
| `SESSION_SECRET`, `TICKET_SECRET`          | Two separate random secrets, each at least 32 characters. Keep the ticket secret stable so existing QR tickets remain valid.                  |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth web-client credentials. Register `${APP_URL}/api/v1/auth/google/callback` as the exact redirect URI.                                    |
| `ADMIN_EMAILS`                             | Comma-separated Google account emails allowed to bootstrap admin access on first sign-in. Additional team members can be invited by an admin. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`   | Start with test-mode credentials. Use automatic payment capture.                                                                              |
| `RAZORPAY_WEBHOOK_SECRET`                  | The webhook signing secret, separate from the API key secret.                                                                                 |
| `RESEND_API_KEY`, `EMAIL_FROM`             | Transactional email credentials and a verified sender.                                                                                        |

Create a Razorpay webhook at `${APP_URL}/api/v1/payments/webhook`, subscribed to `payment.captured`, `refund.processed`, and `refund.failed`. Use a public HTTPS staging origin for webhook testing. Browser checkout success does not confirm the booking; a valid capture webhook does.

Staff invitations grant access to the specified Google email on its next sign-in. Existing customer accounts can be promoted immediately. Deactivation revokes existing sessions on their next request. An administrator cannot remove their own access.

### Build and run

```sh
npm run build
npm start
```

Express serves the compiled React application and API from the same origin. Set `NODE_ENV=production`, `APP_MODE=live`, `DATA_STORE=mongodb`, and the production `APP_URL` when deploying. `npm start` expects an already-running MongoDB service; only `npm run dev` manages a local database. Place the Node process behind one trusted HTTPS reverse proxy. The API health endpoint is `/api/health`. To run the dev API and frontend separately with your own database, use `npm run dev:api` and `npm run dev:web`.

A `Dockerfile` is included. Pass secrets to the runtime container through your hosting platform; do not put them in the image. Atlas must allow network access from the deployment. Enable database backups and inspect API/background-job logs in the hosting platform.

## Booking and payment rules

Reservations move from `PAYMENT_PENDING` to `CONFIRMED`, `CHECKED_IN`, and `COMPLETED`. Other end states are `CANCELLED`, `NO_SHOW`, and `EXPIRED`. Check-in opens 15 minutes before the reserved start and closes at its end. No-shows are staff decisions after the grace period. An overdue seated party keeps the table occupied until staff completes the visit.

MongoDB transactions serialize mutations through a restaurant revision document. Minute-level slot locks also have a unique `(tableId, slot)` index. Concurrent overlapping bookings cannot both commit. Walk-ins and online bookings use the same conflict checks. Expiration runs every 15 seconds and is also applied during booking creation, without depending on TTL deletion timing.

Payment amounts come from the server. Webhooks require a raw-body HMAC signature and are deduplicated by event ID. Cancelling a captured booking releases the table and queues a manual refund review. Approvals are submitted in the background; successful provider events settle the refund. Captures arriving after an expired or cancelled hold are automatically queued for a full refund and never reactivate the reservation.

Ambiguous refund responses are not blindly retried. The worker reconciles with Razorpay by refund receipt. A `SUBMITTING` refund that stays unresolved or a `FAILED` refund requires review in the Razorpay dashboard; there is deliberately no resubmit button that could duplicate a refund. Partial refunds and externally created multiple refunds are outside the first-release workflow.

Email delivery uses a persistent notification outbox, provider idempotency keys, and exponential retries (up to eight attempts). In-app updates do not depend on email delivery.

## Verification

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm audit
```

Unit and HTTP integration tests cover concurrency, rollback, slot boundaries, timezones/DST, holidays, expiry, cancellation, no-shows, late and repeated payments, refund decisions, tampered QR codes, role enforcement, CSRF, deactivated users, and public-data privacy. A real temporary MongoDB replica set verifies transactional conflicts and rollback; the first test run downloads a MongoDB binary.

Playwright checks desktop and mobile screens, table management, settings, invitations, customer reservation/payment/cancellation/refund, and walk-in lookup/completion. It saves screenshots in `test-results/`. Run browser tests against the disposable in-memory demo, not your persistent database. Stop any dev stack first; Playwright starts `npm run dev:memory` automatically. Run the walk-in test during a time at least 15 minutes before midnight in the restaurant timezone. Further test execution is currently skipped at the user's request.

Live Google OAuth, Razorpay payments/webhooks, email delivery, and hardware camera permissions need staging checks with your own credentials before launch. Automated payment tests use the demo gateway and signed payload fixtures, not live money.

## Project layout

```text
src/          React pages, client queries, responsive styles
shared/       TypeScript domain and API response types
server/       Express API, domain rules, transactional stores, integrations
tests/        Domain, API, MongoDB integration, and browser tests
```

API routes are under `/api/v1`: `session`, `auth`, `availability`, `bookings`, `checkout`, `payments/webhook`, `notifications`, `staff/*`, and `admin/*`. Mutations require the session's `X-CSRF-Token` header, except signature-protected provider webhooks. All protected routes enforce roles on the server.

This version targets one restaurant. The storage adapter loads restaurant state within transactions to keep the small deployment easy to audit; it is not designed for unbounded history or many branches. Before expanding, add indexed repository queries, pagination/archiving, per-location gates, and a dedicated job worker. Food ordering, POS settlement, table moves/extensions, editable floor plans, partial refunds, SMS, and native apps are outside this release.

## Integration references

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Razorpay webhook validation and event ordering](https://razorpay.com/docs/webhooks/validate-test/)
- [Razorpay full refunds](https://razorpay.com/docs/api/refunds/create-normal/)
- [MongoDB transactions](https://www.mongodb.com/docs/manual/core/transactions/)
