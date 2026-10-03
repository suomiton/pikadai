import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against the real dev server: Vite, the Worker in workerd, local D1
 * and the Turnstile test keys. Each test sends its own `CF-Connecting-IP` (see
 * e2e/fixtures.ts) so the per-client rate limits and ticket binding behave as in
 * production without tests tripping over each other.
 *
 * A third project runs e2e/preview.spec.ts against the production build served by
 * `vite preview`: the security headers exist only in the built output, and the widget
 * must render under that CSP.
 */
/** Override with PORT when 5173 is taken, for example by another checkout's dev server. */
const port = Number(process.env.PORT ?? 5173);
const baseURL = `http://localhost:${port}`;
const previewPort = Number(process.env.PREVIEW_PORT ?? 4173);
const previewURL = `http://localhost:${previewPort}`;
/** Cloudflare's public always-passing test site key; the matching test secret is in .dev.vars.example. */
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

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
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /preview\.spec\.ts$/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testIgnore: /preview\.spec\.ts$/ },
    { name: 'preview', use: { ...devices['Desktop Chrome'], baseURL: previewURL }, testMatch: /preview\.spec\.ts$/ },
  ],
  webServer: [
    {
      command: `npm run dev -- --port ${port} --strictPort`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // The production bundle, built with the test site key so the widget renders under the real CSP.
      command: `npm run build && npx vite preview --port ${previewPort} --strictPort`,
      url: previewURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { VITE_TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY },
    },
  ],
});
