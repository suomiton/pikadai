# pikadai

[![CI](https://github.com/suomiton/pikadai/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/suomiton/pikadai/actions/workflows/ci.yml?query=branch%3Amain)
[![Deploy](https://github.com/suomiton/pikadai/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/suomiton/pikadai/actions/workflows/deploy.yml?query=branch%3Amain)

Live app: [pikadai.suomiton.workers.dev](https://pikadai.suomiton.workers.dev)

Anonymous, login-free date polls. Create a poll, share one link, people answer and comment under a name they pick.
No accounts, no email, no cookies, no tracking. Polls delete themselves after they expire.

Runs entirely on Cloudflare's free plan: a Worker (TypeScript, Hono) serves both the React app and the
API from one origin, with D1 for storage, Turnstile and rate limiting against abuse, and a nightly cron
purge.

## Documentation

| Document                                       | Read it for                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Architecture](docs/architecture.md)           | how the pieces fit, trust model, request flows, abuse controls, API reference, decisions |
| [Cloudflare services](docs/cloudflare.md)      | Workers, static assets, D1, rate limiting, Turnstile, cron, secrets; limits and commands |
| [Deployment](docs/deployment.md)               | first-time setup, routine deploys, rollback, secrets, custom domain, troubleshooting     |
| [Project structure](docs/project-structure.md) | directory map, build pipeline, conventions, where to change things                       |
| [Database](docs/database.md)                   | schema, integrity rules, expiry, migrations, local database                              |
| [Review findings](docs/review-findings.md)     | open backlog from the 2026-10-03 review: security, accessibility, mobile, code patterns  |
| [Code review](docs/code-review-2026-10-03.md)  | follow-up review: data-loss races, lost credentials, lost drafts, CI and coverage        |

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
npm run test:coverage               # the same, with Istanbul coverage and thresholds; report in coverage/
npx playwright install chromium     # once per machine
npm run test:e2e                    # browser journeys against the dev server and the production preview
```

GitHub Actions runs lint, formatting, the production build (which type-checks), both Vitest projects with
coverage thresholds, and the browser suite on every push to `main` and every pull request into it
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)); the badge at the top shows `main`. After those
checks pass on a push to `main`, [the deployment workflow](.github/workflows/deploy.yml) builds the tested
commit, applies production database migrations, and publishes to Cloudflare. The Deploy badge shows its
status. See [the CI token setup](docs/deployment.md#continuous-deployment).

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
