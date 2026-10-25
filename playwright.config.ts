import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: { baseURL: 'http://localhost:5173', headless: true, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev:memory',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 60000,
  },
  reporter: 'list',
});
