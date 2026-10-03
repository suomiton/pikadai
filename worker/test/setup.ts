import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test';
import { afterEach, vi } from 'vitest';

// The D1 schema, from migrations/, exactly as production applies it.
const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS;
await applyD1Migrations(env.DB, migrations);

// Tests stub the global fetch to stand in for Turnstile's siteverify; never leak that between tests.
afterEach(() => {
  vi.unstubAllGlobals();
});
