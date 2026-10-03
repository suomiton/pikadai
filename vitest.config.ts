import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Separate from vite.config.ts on purpose: the Cloudflare plugin there starts a
 * local workerd, which the pure-function tests do not need.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    include: ['shared/**/*.test.ts', 'worker/**/*.test.ts', 'src/lib/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
