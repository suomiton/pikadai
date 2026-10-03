# pikadai

Anonymous, login-free date polls. Create a poll, share one link, people answer with a nickname.
No accounts, no email, no cookies, no tracking. Polls delete themselves after they expire.

Runs entirely on Cloudflare's free plan: a Worker (TypeScript, Hono) serves both the React app and the
API from one origin, with D1 for storage, Turnstile and rate limiting against abuse, and a nightly cron
purge.

## Documentation

| Document | Read it for |
| --- | --- |
| [Architecture](docs/architecture.md) | how the pieces fit, trust model, request flows, abuse controls, API reference, decisions |
| [Cloudflare services](docs/cloudflare.md) | Workers, static assets, D1, rate limiting, Turnstile, cron, secrets; limits and commands |
| [Deployment](docs/deployment.md) | first-time setup, routine deploys, rollback, secrets, custom domain, troubleshooting |
| [Project structure](docs/project-structure.md) | directory map, build pipeline, conventions, where to change things |
| [Database](docs/database.md) | schema, integrity rules, expiry, migrations, local database |
| [Review findings](docs/review-findings.md) | open backlog from the 2026-10-03 review: security, accessibility, mobile, code patterns |

## Quick start

```sh
npm install
cp .dev.vars.example .dev.vars      # Turnstile test secret + ticket signing secret
npm run cf-typegen                  # generates worker-configuration.d.ts
npm run db:migrate:local            # creates the local D1 schema
npm run dev                         # http://localhost:5173
```

The development build uses Cloudflare's public Turnstile test keys, which always pass.

## Tests

```sh
npm test                            # unit tests, then the Worker inside workerd with a local D1
npx playwright install chromium     # once per machine
npm run test:e2e                    # browser journeys against the dev server (started if needed)
```

## Deploy

See [docs/deployment.md](docs/deployment.md). In short: create the D1 database, set two secrets, put your
Turnstile site key in `.env.production`, and run `npm run deploy`.

## Layout

```
worker/        Hono API: routes/, db/queries.ts, lib/ (auth, crypto, tickets, turnstile, ratelimit), test/
shared/        zod schemas, limits and types imported by both sides
src/           React app: pages/, components/, lib/ (api client, storage, dates, votes), styles/
migrations/    D1 SQL migrations
e2e/           Playwright browser tests
docs/          Documentation
```

Unit tests sit next to the code they test as `*.test.ts`.
