import { config } from './config.js';
import { MemoryStore, MongoStore } from './store.js';
import { seed } from './seed.js';
import { BookingService } from './service.js';
import { DemoGateway, RazorpayGateway } from './gateway.js';
import { createApp } from './app.js';
import { expireHolds } from './domain.js';

const demo = config.APP_MODE === 'demo';
const store =
  config.DATA_STORE === 'mongodb'
    ? await new MongoStore().connect(config.MONGODB_URI!)
    : new MemoryStore();
await store.transaction((s) => seed(s, demo, config.TICKET_SECRET));
const service = new BookingService(
  store,
  demo ? new DemoGateway() : new RazorpayGateway(),
  config.TICKET_SECRET,
  demo,
);
const server = createApp(service).listen(config.PORT, demo ? '127.0.0.1' : '0.0.0.0', () =>
  console.log(
    `Lopez API · http://localhost:${config.PORT} · ${store.kind === 'mongodb' ? 'MongoDB persistence' : 'in-memory storage'} · ${demo ? 'DEMO — simulated payments' : 'LIVE'}`,
  ),
);
let working = false;
const worker = setInterval(async () => {
  if (working) return;
  working = true;
  try {
    await store.transaction((s) => expireHolds(s));
    await service.processRefunds();
    const notifications = (await store.read()).notifications.filter(
      (n) =>
        !n.sent &&
        n.attempts < 8 &&
        (!n.nextAttemptAt || Date.parse(n.nextAttemptAt) <= Date.now()),
    );
    for (const note of notifications) {
      try {
        if (!demo && note.email) {
          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${config.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': note.id,
            },
            body: JSON.stringify({
              from: config.EMAIL_FROM,
              to: [note.email],
              subject: note.subject,
              text: `${note.body}\n${config.APP_URL}/my-bookings`,
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) throw new Error('Email delivery failed');
        }
        await store.transaction((s) => {
          s.notifications.find((n) => n.id === note.id)!.sent = true;
        });
      } catch {
        console.warn(
          `Email delivery retry queued: notification=${note.id}, attempt=${note.attempts + 1}`,
        );
        await store.transaction((s) => {
          const n = s.notifications.find((n) => n.id === note.id)!;
          n.attempts++;
          n.nextAttemptAt = new Date(Date.now() + 60000 * 2 ** n.attempts).toISOString();
        });
      }
    }
  } catch (error) {
    console.error('Background job failed:', error instanceof Error ? error.message : error);
  } finally {
    working = false;
  }
}, 15000);
const shutdown = () => {
  clearInterval(worker);
  server.close(() => {
    void store.close().then(() => process.exit(0));
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
