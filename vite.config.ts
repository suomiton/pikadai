import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

/**
 * Security headers for the static assets. Emitted at build time only, because
 * the strict script-src would block Vite's dev-mode React Fast Refresh preamble.
 * Workers Static Assets reads `_headers` from the root of the assets directory.
 */
const STATIC_HEADERS = `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
  Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;

const emitStaticHeaders = (): Plugin => {
  return {
    name: 'pikadai:emit-static-headers',
    apply: 'build',
    generateBundle() {
      if (this.environment.name !== 'client') return;
      this.emitFile({ type: 'asset', fileName: '_headers', source: STATIC_HEADERS });
    },
  };
};

export default defineConfig({
  plugins: [react(), cloudflare(), emitStaticHeaders()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
});
