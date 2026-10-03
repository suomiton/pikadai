import { expect, test } from './fixtures';
import { waitForTurnstile } from './helpers';

/**
 * Against the production build served by `vite preview` (the `preview` project in
 * playwright.config.ts). These are the things the dev server cannot show: the security headers are
 * emitted at build time only, and the dev CSP would block React Fast Refresh. Nothing here writes to
 * the database, which the dev server's journeys share.
 */
test.describe('production preview', () => {
  test('serves the app shell for a poll route and the API from the same origin', async ({ page, request }) => {
    await page.goto('/e/doesnotexist0000000000');
    await expect(page.getByRole('heading', { name: 'Poll unavailable' })).toBeVisible();
    const api = await request.get('/api/events/doesnotexist0000000000');
    expect(api.status()).toBe(404);
    expect(api.headers()['cache-control']).toBe('no-store');
  });

  test('sends the security headers written to _headers at build time', async ({ request }) => {
    const headers = (await request.get('/')).headers();
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain('frame-src https://challenges.cloudflare.com');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
  });

  test('renders the Turnstile widget under the production CSP', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
    });
    await page.goto('/');
    // The button is enabled only once the widget has handed over a token, which needs the challenge
    // script and iframe to load from challenges.cloudflare.com.
    await waitForTurnstile(page.getByRole('button', { name: 'Create poll' }));
    expect(violations).toEqual([]);
  });
});
