import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, role: 'admin' | 'customer' | 'staff' = 'admin') {
  await page.goto('/');
  await page
    .getByRole('button', {
      name: role === 'admin' ? 'Admin' : role === 'customer' ? 'Guest' : 'Staff',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Sign in to demo' }).click();
  await expect(
    page.getByRole('heading', {
      name: role === 'customer' ? 'Your evening starts here.' : 'Your dining room, at a glance.',
    }),
  ).toBeVisible();
}
test('admin overview, table editing, settings, team, and responsive layout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await expect(page.locator('.table-card')).toHaveCount(12);
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Occupied', exact: true }).click();
  await page.getByRole('button', { name: 'All tables', exact: true }).click();
  await page.getByRole('link', { name: 'Tables & spaces' }).click();
  await page.getByRole('button', { name: 'Add table' }).click();
  const number = `T${Date.now().toString().slice(-5)}`;
  await page.getByRole('textbox', { name: 'Table number' }).fill(number);
  await page.getByRole('spinbutton', { name: 'Seats', exact: true }).fill('6');
  await page.getByRole('button', { name: 'Save table' }).click();
  await expect(page.getByText(`Table ${number}`, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Team members' }).click();
  await page.getByRole('button', { name: 'Invite member' }).click();
  const email = `team-${Date.now()}@example.com`;
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.getByRole('dialog').getByRole('button', { name: 'Invite member' }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Your dining room, at a glance.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('link', { name: 'Reservations', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('customer books, pays, receives QR, cancels, and admin approves refund', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, 'customer');
  const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  await page.locator('.booking-filters input[type=date]').fill(date);
  const choice = page.locator('.choice-table:not(:disabled)').first();
  await expect(choice).toBeVisible();
  await choice.click();
  await page.screenshot({ path: 'test-results/customer-booking.png', fullPage: true });
  await page.getByRole('button', { name: 'Reserve this table' }).click();
  await page.getByRole('button', { name: /Simulate .* payment/ }).click();
  await expect(page.getByRole('heading', { name: 'Your table ticket.' })).toBeVisible();
  await expect(page.locator('.ticket-qr svg')).toBeVisible();
  const code = await page.locator('.booking-code').innerText();
  await page.screenshot({ path: 'test-results/ticket.png', fullPage: true });
  await page.getByRole('button', { name: 'Cancel reservation', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.locator('.ticket-header .badge')).toHaveText('cancelled');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Sign in to demo' }).click();
  await page.getByRole('link', { name: 'Deposits & refunds' }).click();
  const row = page.getByRole('row').filter({ hasText: code });
  await row.getByRole('button', { name: 'Approve', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Reason shared with the guest' })
    .fill('Cancelled before the visit. Happy to welcome you another time.');
  await page.getByRole('button', { name: 'Confirm decision' }).click();
  await expect(row.locator('.badge')).toHaveText('refunded', { timeout: 35000 });
});

test('walk-in ticket lookup and visit completion', async ({ page }) => {
  await login(page);
  // Expand demo service hours through the real API for deterministic walk-in coverage.
  // This is test-only setup, restored afterwards; it does not bypass booking validation.
  const session = await (await page.request.get('/api/v1/session')).json();
  const original = session.settings;
  const expanded = {
    ...original,
    durationMinutes: 15,
    hours: original.hours.map((h: object) => ({
      ...h,
      open: '00:00',
      close: '23:59',
      closed: false,
    })),
  };
  await page.request.put('/api/v1/admin/settings', {
    headers: { 'x-csrf-token': session.csrf },
    data: expanded,
  });
  try {
    await page.reload();
    await page.getByRole('button', { name: 'New walk-in', exact: true }).click();
    await page.getByRole('textbox', { name: 'Guest name' }).fill('Browser Test Guest');
    const select = page.getByRole('combobox', { name: 'Table', exact: true });
    const tableId = await select.locator('option').nth(1).getAttribute('value');
    await select.selectOption(tableId!);
    await page.getByRole('button', { name: 'Seat guest & issue ticket' }).click();
    await expect(page.locator('.ticket-header .badge')).toHaveText('checked in');
    const code = await page.locator('.booking-code').innerText();
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await page.getByRole('button', { name: 'Scan ticket', exact: true }).click();
    await page.getByRole('textbox', { name: 'Or enter the booking code' }).fill(code);
    await page.getByRole('button', { name: 'Find reservation' }).click();
    await expect(page.locator('.booking-code')).toHaveText(code);
    await page.getByRole('button', { name: 'Complete visit', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.locator('.ticket-header .badge')).toHaveText('completed');
  } finally {
    await page.request.put('/api/v1/admin/settings', {
      headers: { 'x-csrf-token': session.csrf },
      data: original,
    });
  }
});

test('customer access stays restricted on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'customer');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/customer-mobile.png', fullPage: true });
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/book$/);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'My bookings' }).click();
  await expect(page.getByRole('heading', { name: 'Your visits to Lopez.' })).toBeVisible();
});
