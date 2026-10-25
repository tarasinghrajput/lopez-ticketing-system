import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { createApp } from '../server/app.js';
import { MemoryStore } from '../server/store.js';
import { BookingService } from '../server/service.js';
import { DemoGateway } from '../server/gateway.js';
import { seed } from '../server/seed.js';
import { demoAccounts } from '../shared/demo-accounts.js';

let store: MemoryStore, app: ReturnType<typeof createApp>;
beforeEach(async () => {
  store = new MemoryStore();
  await store.transaction((s) => seed(s, true, 'test'));
  app = createApp(new BookingService(store, new DemoGateway(), 'test', true));
});
async function signIn(role: keyof typeof demoAccounts) {
  const client = request.agent(app);
  const initial = await client.get('/api/v1/session');
  await client
    .post('/api/v1/auth/login')
    .set('x-csrf-token', initial.body.csrf)
    .send({ email: demoAccounts[role].email, password: demoAccounts[role].password })
    .expect(200);
  const session = await client.get('/api/v1/session');
  return { client, csrf: session.body.csrf };
}
describe('HTTP boundaries', () => {
  it('rejects anonymous access and CSRF-free writes', async () => {
    await request(app).get('/api/v1/bookings').expect(401);
    const { client } = await signIn('ADMIN');
    await client.post('/api/v1/admin/tables').send({}).expect(403);
  });
  it('restricts settings, users, and refunds to admin', async () => {
    const { client, csrf } = await signIn('STAFF');
    await client.get('/api/v1/admin/team').expect(403);
    await client.get('/api/v1/admin/refunds').expect(403);
    await client.put('/api/v1/admin/settings').set('x-csrf-token', csrf).send({}).expect(403);
  });
  it('restricts operational lookup and dashboard to staff', async () => {
    const { client, csrf } = await signIn('CUSTOMER');
    await client.get('/api/v1/staff/dashboard').expect(403);
    await client
      .post('/api/v1/staff/ticket-lookup')
      .set('x-csrf-token', csrf)
      .send({ value: 'LP-1' })
      .expect(403);
  });
  it('never exposes guest identities in public availability', async () => {
    const date = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).toISODate();
    const response = await request(app)
      .get(`/api/v1/availability?date=${date}&partySize=2`)
      .expect(200);
    expect(response.body.tables).toHaveLength(12);
    expect(JSON.stringify(response.body)).not.toContain('guestName');
    expect(JSON.stringify(response.body)).not.toContain('email');
  });
  it('handles a full customer checkout and cancellation with refund review', async () => {
    const { client, csrf } = await signIn('CUSTOMER');
    const date = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).toISODate();
    const a = await client.get(`/api/v1/availability?date=${date}&partySize=2`).expect(200);
    const b = await client
      .post('/api/v1/bookings')
      .set('x-csrf-token', csrf)
      .send({ tableId: 'table-1', partySize: 2, start: a.body.start })
      .expect(201);
    expect(b.body.ticketToken).toBeUndefined();
    const paid = await client
      .post(`/api/v1/checkout/${b.body.id}/demo-pay`)
      .set('x-csrf-token', csrf)
      .send({})
      .expect(200);
    expect(paid.body.status).toBe('CONFIRMED');
    const cancel = await client
      .post(`/api/v1/bookings/${b.body.id}/actions`)
      .set('x-csrf-token', csrf)
      .send({ action: 'cancel' })
      .expect(200);
    expect(cancel.body.payment.refundStatus).toBe('REVIEW');
  });
  it('validates table uniqueness and input capacity', async () => {
    const { client, csrf } = await signIn('ADMIN');
    await client
      .post('/api/v1/admin/tables')
      .set('x-csrf-token', csrf)
      .send({ number: '01', capacity: 2, area: 'Main', active: true, order: 0 })
      .expect(409);
    await client
      .post('/api/v1/admin/tables')
      .set('x-csrf-token', csrf)
      .send({ number: '99', capacity: -1, area: 'Main', active: true, order: 0 })
      .expect(400);
  });
  it('immediately revokes access for deactivated staff', async () => {
    const admin = await signIn('ADMIN'),
      staff = await signIn('STAFF');
    await admin.client
      .patch('/api/v1/admin/team/demo-staff')
      .set('x-csrf-token', admin.csrf)
      .send({ role: 'STAFF', active: false })
      .expect(200);
    await staff.client.get('/api/v1/staff/dashboard').expect(401);
  });
  it('prevents an administrator changing their own access', async () => {
    const { client, csrf } = await signIn('ADMIN');
    await client
      .patch('/api/v1/admin/team/demo-admin')
      .set('x-csrf-token', csrf)
      .send({ role: 'STAFF', active: false })
      .expect(400);
  });
  it('rejects cross-origin requests even with a valid CSRF token', async () => {
    const { client, csrf } = await signIn('ADMIN');
    await client
      .post('/api/v1/auth/logout')
      .set('origin', 'https://evil.example')
      .set('x-csrf-token', csrf)
      .send({})
      .expect(403);
  });
});
