import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { configDefaults, coverageConfigDefaults, defineConfig } from 'vitest/config';

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
    coverage: {
      // Workers need instrumented coverage: workerd has no native V8 coverage.
      provider: 'istanbul',
      include: ['src/**/*.{ts,tsx}', 'shared/**/*.ts', 'worker/**/*.ts'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        'worker/test/**',
        'src/main.tsx',
        'src/router.tsx',
        'src/vite-env.d.ts',
      ],
      reporter: ['text', 'html', 'lcov'],
      // Guard the logic the unit and Worker tests own, a few points under what they measure, so a
      // change that drops coverage fails CI. Components, hooks and the API client are exercised by
      // the browser suite and stay visible in the report without a threshold.
      thresholds: {
        'shared/**/*.ts': { statements: 95, branches: 95 },
        'src/state/*.ts': { statements: 90, branches: 95 },
        'src/lib/{dates,errors,participantLink,storage,timing,votes}.ts': { statements: 90, branches: 90 },
        'worker/**/*.ts': { statements: 90, branches: 75 },
      },
    },
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
              // The pool ships its own workerd, which trails the compatibility_date in wrangler.jsonc
              // (2026-09-01): the tests run on the newest date that binary supports. Remove this
              // override once @cloudflare/vitest-pool-workers bundles a workerd that accepts the
              // deployment date; the browser suite's `preview` project runs the built Worker on it.
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
