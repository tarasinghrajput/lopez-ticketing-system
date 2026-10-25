import { test, expect } from '@playwright/test';

test('gateway opens outside the native dialog and browser success cannot confirm payment', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Guest', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in to demo' }).click();
  await expect(page.getByRole('heading', { name: 'Your evening starts here.' })).toBeVisible();
  await page.route('**/api/v1/session', async route => { const response = await route.fetch(); const body = await response.json(); await route.fulfill({ response, json: { ...body, mode: 'live' } }); });
  await page.addInitScript(() => {
    (window as unknown as { Razorpay: unknown }).Razorpay = class {
      constructor(private options: Record<string, unknown>) {}
      on() {}
      open() {
        if (document.querySelector('dialog[open]')) throw new Error('Checkout iframe would be blocked by native modal');
        const button = document.createElement('button'); button.textContent = 'Complete test gateway'; button.id = 'test-gateway';
        button.onclick = () => { (this.options.handler as () => void)(); button.remove(); };
        document.body.appendChild(button);
      }
    };
  });
  await page.reload();
  await page.locator('.booking-filters input[type=date]').fill(new Date(Date.now() + 3 * 86400000).toISOString().slice(0,10));
  await page.locator('.choice-table:not(:disabled)').first().click();
  await page.getByRole('button', { name: 'Reserve this table' }).click();
  await page.getByRole('button', { name: /Pay .* securely/ }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Complete test gateway' }).click();
  await expect(page.getByText(/Waiting for verified confirmation/)).toBeVisible();
  const bookingId = new URL(page.url()).searchParams.get('checkout');
  const pending = await (await page.request.get(`/api/v1/bookings/${bookingId}`)).json();
  expect(pending.status).toBe('PAYMENT_PENDING');
  const session = await (await page.request.get('/api/v1/session')).json();
  await page.request.post(`/api/v1/checkout/${bookingId}/demo-pay`, { headers: { 'x-csrf-token': session.csrf }, data: {} });
  await expect(page.getByRole('heading', { name: 'Your table ticket.' })).toBeVisible();
  // Leave no active reservation behind for subsequent browser tests.
  await page.request.post(`/api/v1/bookings/${bookingId}/actions`, { headers: { 'x-csrf-token': session.csrf }, data: { action: 'cancel' } });
});
