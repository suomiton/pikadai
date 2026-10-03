import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against the real dev server: Vite, the Worker in workerd, local D1
 * and the Turnstile test keys. Each test sends its own `CF-Connecting-IP` (see
 * e2e/fixtures.ts) so the per-client rate limits and ticket binding behave as in
 * production without tests tripping over each other.
 */
/** Override with PORT when 5173 is taken, for example by another checkout's dev server. */
const port = Number(process.env.PORT ?? 5173);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
