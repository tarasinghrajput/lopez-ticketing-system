import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('welcome, dashboard, and walk-in dialog meet automated accessibility checks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in to demo' })).toBeVisible();
  let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
  await page.getByRole('button', { name: 'Sign in to demo' }).click();
  await expect(page.getByRole('heading', { name: 'Your dining room, at a glance.' })).toBeVisible();
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
  await page.getByRole('button', { name: 'New walk-in', exact: true }).click();
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
});
