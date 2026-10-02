# pikadai

Anonymous, login-free date polls. Create a poll, share one link, people answer with a nickname.
No accounts, no email, no cookies, no tracking. Polls delete themselves after they expire.

## Stack

| Layer     | Choice                                                    |
| --------- | --------------------------------------------------------- |
| Frontend  | React 19 + TypeScript, Vite                               |
| Backend   | Cloudflare Worker (TypeScript, Hono)                      |
| Database  | Cloudflare D1 (SQLite)                                    |
| Anti-abuse| Cloudflare Turnstile, per-IP rate limiting, creation tickets |
| Hosting   | Workers static assets serve the SPA on the same origin as the API |

Everything runs on the Workers free plan. There is no separate API hostname and no CORS.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars      # Turnstile test secret + ticket signing secret
npm run cf-typegen                  # generates worker-configuration.d.ts (Env type)
npm run db:migrate:local            # applies migrations/ to the local D1
npm run dev                         # http://localhost:5173, API + SPA together
```

`.env.development` ships with Cloudflare's public Turnstile *test* site key, which always passes.

To exercise the nightly cleanup locally:

```sh
npx wrangler dev --test-scheduled   # then: curl "http://localhost:8787/__scheduled?cron=17+3+*+*+*"
```

## Deploy

1. `npm run db:create` and paste the printed `database_id` into `wrangler.jsonc`.
2. `npm run db:migrate:remote`
3. Create a Turnstile widget in the Cloudflare dashboard for your hostname.
   - Put the **site key** in `.env.production` (`VITE_TURNSTILE_SITE_KEY`).
   - `npx wrangler secret put TURNSTILE_SECRET_KEY`
4. `npx wrangler secret put TICKET_SECRET` with a long random value, for example `openssl rand -base64 32`.
5. `npm run deploy`

## How it stays anonymous and hard to abuse

- **Capability URLs.** Poll ids are 128-bit random. There is no listing endpoint, so nothing can be enumerated.
- **Two links per poll.** The admin link carries a separate 256-bit token in the URL fragment. The browser
  moves it to localStorage on first visit and strips it from the address bar. Only SHA-256 hashes of tokens
  are stored.
- **Per-answer edit tokens.** Saving your availability returns a token kept in your browser, so only you can
  edit your row. The organiser can edit or remove any row.
- **Turnstile** on poll creation and on first answer. Verified server-side.
- **Rate limiting** per IP via the Workers rate-limit binding. The IP is only an in-memory key and is never
  stored or logged.
- **Creation tickets.** Pressing Create fetches an HMAC-signed ticket. The Worker rejects the poll unless the
  ticket is at least `MIN_CREATE_DELAY_MS` old, and each ticket is single-use. The progress steps in the UI
  mask this wait. A script cannot skip it.
- **Hard limits** on title, description, nickname length, dates per poll, and participants per poll.
- **Expiry.** A poll expires 30 days after its last date, and a nightly cron purges expired rows. Deleting a
  poll cascades to its dates, answers and votes.
- **Strict CSP and security headers** on the static assets (emitted as `_headers` at build time) and
  `Cache-Control: no-store` on the API.

## Layout

```
worker/        Hono API: routes/, db/queries.ts, lib/ (auth, crypto, tickets, turnstile, ratelimit)
shared/        zod schemas, limits and types imported by both sides
src/           React app: pages/, components/, lib/ (api client, storage, dates), styles/
migrations/    D1 SQL migrations
```
