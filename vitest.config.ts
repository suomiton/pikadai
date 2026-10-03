import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Two projects. `unit` runs pure functions under Node; `worker` runs the real
 * Worker inside workerd with a local D1 (migrations applied in worker/test/setup.ts),
 * the rate-limit bindings from wrangler.jsonc and a non-testing Turnstile secret, so
 * the hostname and action checks are exercised against a stubbed siteverify.
 * Separate from vite.config.ts because the Cloudflare Vite plugin there starts a
 * dev-server workerd that the tests do not want.
 */
const alias = { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['shared/**/*.test.ts', 'worker/**/*.test.ts', 'src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'worker/test/**'],
          setupFiles: ['./test/setup.ts'],
        },
      },
      {
        resolve: { alias },
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              // The pool ships its own workerd, which can trail the compatibility_date in
              // wrangler.jsonc. Tests run on the newest date that binary supports; bump this
              // alongside @cloudflare/vitest-pool-workers upgrades.
              compatibilityDate: '2026-08-22',
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations('./migrations'),
                // Deliberately not one of Cloudflare's testing secrets, so the hostname
                // and action checks apply; the siteverify call itself is stubbed.
                TURNSTILE_SECRET_KEY: 'integration-test-turnstile-secret',
                TICKET_SECRET: 'integration-test-ticket-secret',
              },
            },
          })),
        ],
        test: {
          name: 'worker',
          include: ['worker/test/**/*.test.ts'],
          setupFiles: ['./worker/test/setup.ts'],
        },
      },
    ],
  },
});
