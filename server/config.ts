import 'dotenv/config';
import { z } from 'zod';

const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_MODE: z.enum(['demo', 'live']).default('demo'),
    DATA_STORE: z.enum(['memory', 'mongodb']).default('memory'),
    PORT: z.coerce.number().default(4000),
    APP_URL: z.url().default('http://localhost:5173'),
    SESSION_SECRET: z.string().default('local-demo-session-secret-not-for-production'),
    TICKET_SECRET: z.string().default('local-demo-ticket-secret-not-for-production'),
    MONGODB_URI: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    ADMIN_EMAILS: z.string().default(''),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
  })
  .parse(process.env);

if (env.NODE_ENV === 'production' && env.APP_MODE === 'demo')
  throw new Error('Production cannot use demo mode. Set APP_MODE=live.');
if (env.DATA_STORE === 'mongodb' && !env.MONGODB_URI)
  throw new Error('MongoDB storage requires MONGODB_URI.');
if (env.APP_MODE === 'live') {
  if (env.DATA_STORE !== 'mongodb') throw new Error('Live mode requires DATA_STORE=mongodb.');
  for (const key of [
    'MONGODB_URI',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'ADMIN_EMAILS',
  ] as const) {
    if (!env[key]) throw new Error(`Live mode requires ${key}`);
  }
  if (
    env.SESSION_SECRET.length < 32 ||
    env.TICKET_SECRET.length < 32 ||
    env.SESSION_SECRET.startsWith('local-demo') ||
    env.TICKET_SECRET.startsWith('local-demo')
  )
    throw new Error(
      'Set unique SESSION_SECRET and TICKET_SECRET values of at least 32 characters.',
    );
  if (env.NODE_ENV === 'production' && !env.APP_URL.startsWith('https://'))
    throw new Error('Production APP_URL must use HTTPS.');
}
export const config = env;
