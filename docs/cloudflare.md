# Cloudflare services

Pikadai runs entirely on Cloudflare's free plan. This document covers only the services the project uses,
how each is configured here, and the behaviours that matter for development and operations. It is not a
general Cloudflare tutorial; links to the official docs are at the end.

## Account and plan

- A free Cloudflare account is enough. No payment method is needed for Workers, static assets, D1,
  Turnstile, or cron triggers.
- Everything is managed from this repository with `wrangler`, which is installed as a dev dependency.
  Run it as `npx wrangler …` or through the npm scripts in `package.json`.
- The first `npx wrangler login` opens a browser for OAuth and stores a token under `~/.config/.wrangler/`.

## Workers

The Worker is the API. Its entry point is `worker/index.ts`, declared as `main` in `wrangler.jsonc`.

**Runtime model.** Workers run on V8 isolates at the edge, not Node.js. The standard Web APIs are
available: `fetch`, `Request`, `Response`, `crypto.subtle`, `URL`, `TextEncoder`. Node built-ins are not,
unless the `nodejs_compat` flag is enabled; this project does not need it. One useful non-standard
addition is `crypto.subtle.timingSafeEqual`, which the token checks rely on.

**Compatibility date.** `compatibility_date` in `wrangler.jsonc` pins runtime behaviour to a snapshot.
Bump it deliberately after reading the changelog, and re-run `npm run cf-typegen`.

**Handlers exported.** `fetch` for HTTP and `scheduled` for the cron trigger. Both are in
`worker/index.ts`.

**Free-plan limits that matter.**

| Limit | Free plan |
| --- | --- |
| Requests to the Worker | 100,000 per day |
| CPU time per request | 10 ms |
| Worker script size | 3 MB compressed |
| Requests to static assets | unlimited, not counted |

The API does little CPU work per request; SHA-256 and HMAC over short strings are microseconds. Turnstile
verification is network wait, which does not count as CPU time.

**Types.** `npm run cf-typegen` runs `wrangler types`, which reads `wrangler.jsonc` and `.dev.vars` and
writes `worker-configuration.d.ts`. That file declares the global `Env` interface with every binding, var,
and secret, plus the full runtime type library. Re-run it whenever `wrangler.jsonc` or `.dev.vars` changes.

## Static assets

The React build is uploaded alongside the Worker and served by Cloudflare's asset layer. Configuration is
the `assets` block in `wrangler.jsonc`:

```jsonc
"assets": {
  "binding": "ASSETS",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/api/*"]
}
```

- `run_worker_first` forces `/api/*` to the Worker even if an asset happened to match.
- `not_found_handling: single-page-application` serves `index.html` for any path that is not an asset,
  which is what client-side routing needs for `/e/:id`.
- `binding: ASSETS` exposes the asset store to the Worker as `env.ASSETS`. The Worker's not-found handler
  forwards non-API requests there as a safety net.
- The asset directory is not set here because the Vite plugin manages it; the generated config in
  `dist/pikadai/wrangler.json` points at `dist/client`.

**Headers.** A `_headers` file at the root of the asset directory sets response headers per path pattern.
Ours is generated at build time by the `emitStaticHeaders` plugin in `vite.config.ts`; see
[architecture.md](architecture.md#transport-security-and-headers) for the policy. `_headers` applies only to
asset responses, so the Worker sets its own headers for `/api/*`.

**Caching.** Hashed files under `/assets/*` are marked immutable for a year. `index.html` is not
long-cached, so a deploy takes effect on the next navigation.

## The Vite plugin

`@cloudflare/vite-plugin` ties the two halves together.

- `npm run dev` starts one Vite server that serves the React app with hot reload and runs the Worker in
  a local `workerd` with the same bindings as production: D1, rate limiters, secrets from `.dev.vars`, and
  the asset routing rules above. The URL is `http://localhost:5173`.
- `npm run build` runs `tsc -b` and then Vite builds two environments: the client into `dist/client/` and
  the Worker into `dist/pikadai/`. It also writes `dist/pikadai/wrangler.json`, a resolved copy of the
  config, and `.wrangler/deploy/config.json`, a redirect that tells `wrangler deploy` to use it.
- Because of that redirect, run `wrangler deploy` only after a fresh build. `npm run deploy` does both.
- The dev server also exposes a local explorer under `/cdn-cgi/local/explorer/api/` for listing bindings,
  querying local D1, and invoking the scheduled handler. It exists only in development.

## D1

D1 is Cloudflare's hosted SQLite. The binding is `DB`, declared in `d1_databases` in `wrangler.jsonc`.

**Local versus remote.** There are two databases. Locally, `workerd` keeps a SQLite file under
`.wrangler/state/v3/d1/`, shared by `npm run dev` and `wrangler d1 … --local`. Remotely, D1 is the real
thing. Every `wrangler d1` command defaults to local and needs `--remote` to touch production.

**Migrations.** SQL files in `migrations/`, applied in filename order. D1 records which have run in a
`d1_migrations` table it manages. Commands:

```sh
npm run db:migrate:local    # wrangler d1 migrations apply pikadai --local
npm run db:migrate:remote   # wrangler d1 migrations apply pikadai --remote
npx wrangler d1 migrations list pikadai --remote
```

**Behaviours the code depends on.**

- Foreign keys are enforced by default. The schema uses `ON DELETE CASCADE` and `ON DELETE SET NULL`.
- `db.batch([...])` runs its statements in one transaction. Creating an event with its options, or a
  participant with their votes, uses this so a failure leaves nothing half-written.
- A UNIQUE violation surfaces as an error whose message contains `UNIQUE constraint failed`. The Worker
  maps that to `409` for duplicate dates, nicknames, and replayed tickets.
- `COLLATE NOCASE` gives case-insensitive comparison, both in the nickname pre-check query and in the unique
  index that enforces it.

**Free-plan limits.**

| Limit | Free plan |
| --- | --- |
| Storage | 5 GB across all databases |
| Rows read | 5 million per day |
| Rows written | 100,000 per day |
| Databases | 10 |

A poll view reads a few dozen rows; creating or editing writes a handful. These limits are far away for a
hobby service. The nightly purge is one `DELETE` statement.

**Backups.** D1 Time Travel keeps 30 days of history on every database and can restore to any minute:

```sh
npx wrangler d1 time-travel info pikadai
npx wrangler d1 time-travel restore pikadai --timestamp=2026-10-01T12:00:00Z
```

For an offline copy, `npx wrangler d1 export pikadai --remote --output=backup.sql`.

**Inspecting data.**

```sh
npx wrangler d1 execute pikadai --local  --command "SELECT id, title, expires_at FROM events"
npx wrangler d1 execute pikadai --remote --command "SELECT COUNT(*) FROM events"
```

## Rate limiting binding

Three limiters are declared under `ratelimits` in `wrangler.jsonc` and used by the middleware in
`worker/lib/ratelimit.ts`.

| Binding | Limit | Applied to |
| --- | --- | --- |
| `CREATE_LIMITER` | 5 per 60 s | `POST /api/events` |
| `WRITE_LIMITER` | 40 per 60 s | tickets, participants, options, PATCH and DELETE |
| `READ_LIMITER` | 120 per 60 s | `GET /api/events/:id` |

How it behaves:

- The key is derived from the `CF-Connecting-IP` header: the IPv4 address itself, or the /64 prefix of an
  IPv6 address, because one subscriber usually owns a whole /64. `X-Forwarded-For` is ignored since a client
  can set it. The key lives only in the limiter's memory; the Worker never stores or logs it.
- `period` must be 10 or 60 seconds. `namespace_id` is any string that is unique within the account.
- Counting is per Cloudflare location, not global, and is approximate. Treat it as flood protection, not an
  exact quota.
- The binding is emulated in local development, so a burst against `npm run dev` does return `429`.
- Changing limits is a config edit plus redeploy; no code changes.

## Turnstile

Turnstile is Cloudflare's CAPTCHA replacement. It is free and mostly invisible to humans.

**Two keys.** The site key is public and goes in the client bundle via `VITE_TURNSTILE_SITE_KEY` in
`.env.production`. The secret key goes in the Worker as the secret `TURNSTILE_SECRET_KEY` and is only ever
sent to Cloudflare's `siteverify` endpoint from `worker/lib/turnstile.ts`.

**Flow.** The widget (`src/components/TurnstileField.tsx`) produces a token in the browser. The token is
sent with the create-poll or add-answer request. The Worker posts it to
`https://challenges.cloudflare.com/turnstile/v0/siteverify` with the secret and the client IP, then requires
the response's `hostname` to match the request's hostname and its `action` to be the one the widget was
rendered with: `create` on the create page, `answer` in the vote grid. A token solved on another site bound
to the same widget, or for the other form, is refused. Tokens are valid for five minutes and can be verified
once; the Worker runs its cheaper checks first so a rejected request does not spend the token, and the client
resets the widget after any failed submit.

**Hostnames.** A widget is bound to a list of hostnames. Add every hostname the site is served from,
including the `workers.dev` one and any custom domain. A mismatch makes every verification fail with
`captcha_failed`.

**Test keys.** Cloudflare publishes keys that always behave a certain way, which is what local development
uses. They work from any hostname, including `localhost`.

| Purpose | Site key | Secret key |
| --- | --- | --- |
| Always passes | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| Always fails | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AF` |
| Forces an interactive challenge | `3x00000000000000000000FF` | |
| Token already spent | | `3x0000000000000000000000000000000FF` |

`.env.development` and `.dev.vars.example` ship with the always-pass pair. The test secrets always answer
with `hostname: "example.com"` and no `action`, and mark the response with `metadata.result_with_testing_key`;
the Worker skips its hostname and action checks when that flag is set, which is why the pair works on
`localhost`. A test secret in production would accept every token anyway, so the skip gives nothing away.

## Cron triggers

`triggers.crons` in `wrangler.jsonc` holds `"17 3 * * *"`: once a day at 03:17 UTC. Cloudflare calls the
Worker's `scheduled` handler, which deletes expired events and logs how many it removed.

Cron triggers are included on the free plan. The handler's work counts toward the daily request quota as
one request.

To run it locally while `npm run dev` is up:

```sh
curl -X POST "http://localhost:5173/cdn-cgi/local/explorer/api/local/scheduled?worker=pikadai" \
  -H 'content-type: application/json' -d '{"cron":"17 3 * * *"}'
```

Or with plain wrangler: `npx wrangler dev --test-scheduled`, then `curl "http://localhost:8787/__scheduled"`.

In production, the dashboard shows the trigger under the Worker's Settings → Triggers, and each run
appears in the Worker's logs.

## Secrets and variables

| Name | Kind | Set with | Used for |
| --- | --- | --- | --- |
| `TURNSTILE_SECRET_KEY` | secret | `npx wrangler secret put TURNSTILE_SECRET_KEY` | verifying CAPTCHA tokens |
| `TICKET_SECRET` | secret | `npx wrangler secret put TICKET_SECRET` | signing creation tickets |
| `VITE_TURNSTILE_SITE_KEY` | client build var | `.env.production` | rendering the widget |

Secrets are encrypted at rest and never readable back through the API or dashboard. Locally they come
from `.dev.vars`, which is gitignored; copy `.dev.vars.example` to create it. Rotating `TICKET_SECRET`
invalidates in-flight tickets for at most 15 minutes and nothing else.

## Observability

`observability.enabled` is on in `wrangler.jsonc` with `logs.invocation_logs` set to `false`. Workers Logs
therefore keeps only what the Worker itself prints with `console`, queryable under the Worker's
Observability tab, and not the per-request invocation record, which would hold every request's headers and
client IP for days. The routine `console` output is the purge count from the cron handler; unhandled errors
are logged with their stack trace by `app.onError`, without request details. Aggregate metrics (request
counts, status codes, CPU time) stay available under the Metrics tab and contain nothing per visitor.

For a live stream from the terminal:

```sh
npx wrangler tail
```

The stream is not persisted by Cloudflare, but it does show each request's headers and `CF-Connecting-IP`
to whoever runs it. Cloudflare redacts headers it recognises as credentials, heuristically; keeping the
tokens in the standard `Authorization` header gives that heuristic its easiest case, which is why the API
does not use custom token headers.

## Wrangler cheat sheet

| Task | Command |
| --- | --- |
| Log in | `npx wrangler login` |
| Who am I | `npx wrangler whoami` |
| Create the database | `npm run db:create` |
| Apply migrations | `npm run db:migrate:local` / `npm run db:migrate:remote` |
| Run SQL | `npx wrangler d1 execute pikadai [--remote] --command "…"` |
| Set a secret | `npx wrangler secret put NAME` |
| List secrets | `npx wrangler secret list` |
| Build and deploy | `npm run deploy` |
| List deployments | `npx wrangler deployments list` |
| Roll back | `npx wrangler rollback` |
| Stream logs | `npx wrangler tail` |
| Regenerate types | `npm run cf-typegen` |

## Official documentation

- Workers: https://developers.cloudflare.com/workers/
- Static assets: https://developers.cloudflare.com/workers/static-assets/
- Vite plugin: https://developers.cloudflare.com/workers/vite-plugin/
- D1: https://developers.cloudflare.com/d1/
- Rate limiting binding: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- Turnstile: https://developers.cloudflare.com/turnstile/
- Cron triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Wrangler commands: https://developers.cloudflare.com/workers/wrangler/commands/
- Free plan limits: https://developers.cloudflare.com/workers/platform/limits/
