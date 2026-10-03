# Deployment

A runbook for getting Pikadai live on Cloudflare and keeping it there. It assumes you have read nothing
else; where background helps, it links to [cloudflare.md](cloudflare.md).

## When to use this

- First-time setup of a new Cloudflare account or a fresh clone
- Routine deploys after code changes
- Rolling back a bad deploy
- Rotating secrets, changing limits, or adding a domain

## Prerequisites

| Need                        | Check                                     |
| --------------------------- | ----------------------------------------- |
| Node.js 20 or newer and npm | `node --version`                          |
| Project dependencies        | `npm install` has been run                |
| A Cloudflare account        | free plan is enough; no card              |
| Wrangler logged in          | `npx wrangler whoami` prints your account |

Log in with `npx wrangler login`. It opens a browser for OAuth. Do not paste API tokens into files.

## First-time setup

Do these once per Cloudflare account. Steps 1 and 2 are prerequisites for the first deploy; steps 4 and 5
switch from test keys to a real CAPTCHA.

### 1. Create the production database

```sh
npm run db:create
```

The output includes a `database_id`. Open `wrangler.jsonc` and replace the placeholder
`00000000-0000-0000-0000-000000000000` with it. Then apply the schema:

```sh
npm run db:migrate:remote
```

Expected: a table listing every file in `migrations/` with a tick.

### 2. Set the Worker secrets

```sh
openssl rand -base64 32 | npx wrangler secret put TICKET_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
```

For `TURNSTILE_SECRET_KEY`, paste the always-pass test secret `1x0000000000000000000000000000000AA`
for now. You will replace it in step 5. Confirm with `npx wrangler secret list`.

### 3. First deploy with test keys

Put the matching test site key in `.env.production`:

```
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

Deploy:

```sh
npm run deploy
```

This runs the typecheck, builds the client and Worker, uploads both, and prints the URL, typically
`https://pikadai.<your-subdomain>.workers.dev`. Open it and create a poll end to end. With test keys the
CAPTCHA passes for everyone, so do not share the link yet.

### 4. Create a Turnstile widget

In the Cloudflare dashboard: Turnstile → Add widget.

- Hostnames: the `workers.dev` hostname from step 3, plus any custom domain you plan to add.
- Widget mode: Managed. It stays invisible for most visitors and only challenges suspicious ones.

Copy the site key and the secret key.

### 5. Switch to the real keys and redeploy

```sh
# .env.production
VITE_TURNSTILE_SITE_KEY=<site key from step 4>
```

```sh
npx wrangler secret put TURNSTILE_SECRET_KEY   # paste the secret key from step 4
npm run deploy
```

Create another poll to confirm the real widget works. Commit `.env.production`; site keys are public.

### 6. Confirm the nightly purge is scheduled

Dashboard → Workers & Pages → pikadai → Settings → Triggers. The cron `17 3 * * *` should be listed.

## Routine deploy

```sh
npm run deploy
```

What it does, in order:

1. `tsc -b` typechecks the client, Worker, and config projects. A type error stops the deploy.
2. `vite build` writes `dist/client/` (SPA plus `_headers`) and `dist/pikadai/` (Worker bundle plus a
   resolved `wrangler.json`).
3. `wrangler deploy` follows the redirect in `.wrangler/deploy/config.json` to that resolved config and
   uploads everything as one new version.

A deploy is atomic from the user's point of view: assets and Worker switch together. Hashed assets are
cached for a year; `index.html` is not, so visitors get the new version on their next navigation.

Do not run `npx wrangler deploy` on its own. Without a fresh build it deploys stale output.

### If a migration is part of the change

Apply it before deploying code that depends on it:

```sh
npm run db:migrate:remote
npm run deploy
```

Write migrations so the previous code version still works against the new schema, for example by adding
nullable columns rather than renaming. That keeps rollback (below) safe. See
[database.md](database.md#migrations) for the workflow.

## Verifying a deploy

```sh
# Headers on the SPA
curl -sI https://<host>/ | grep -i -E "content-security-policy|x-frame-options"

# API is up and not cached
curl -si https://<host>/api/nope | head -5      # expect 404 JSON and Cache-Control: no-store

# Live logs while you click through the site
npx wrangler tail
```

Then create a poll in a browser, answer it from a private window, and open the admin link.

## Rollback

```sh
npx wrangler deployments list        # find the previous version id
npx wrangler rollback                # interactive, or pass the version id
```

Rollback swaps the Worker and assets back to a previous version within seconds. It does **not** touch the
database. If a migration must be undone, restore with D1 Time Travel to a timestamp before it was applied
(see [cloudflare.md](cloudflare.md#d1)), accepting that any data written since then is lost.

## Rotating secrets

| Secret                 | Effect of rotation                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `TICKET_SECRET`        | Tickets issued before the change fail verification. Anyone mid-creation for up to 15 minutes sees "please try again". Nothing else is affected. |
| `TURNSTILE_SECRET_KEY` | Must match the widget's secret. Rotate by creating a new widget or using the dashboard's rotate action, then `wrangler secret put`.             |

`npx wrangler secret put NAME` takes effect on the next request; no redeploy is needed.

## Changing limits and schedules

| Change                 | Where                                                                                                         | Then                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Rate limits            | `ratelimits` in `wrangler.jsonc`                                                                              | `npm run cf-typegen && npm run deploy`                         |
| Cron schedule          | `triggers.crons` in `wrangler.jsonc`                                                                          | `npm run deploy`                                               |
| Minimum creation delay | `minCreateDelayMs` in `shared/limits.ts`; the client reads it from the ticket response, so nothing else moves | `npm run deploy`                                               |
| Size and count limits  | `shared/limits.ts`                                                                                            | `npm run deploy` (client and Worker update together)           |
| Expiry periods         | `shared/limits.ts`                                                                                            | `npm run deploy`; existing rows keep their stored `expires_at` |

## Custom domain

1. Add your domain to Cloudflare and switch its nameservers to the ones Cloudflare gives you.
2. Add a route to `wrangler.jsonc`:

   ```jsonc
   "routes": [{ "pattern": "poll.example.com", "custom_domain": true }]
   ```

3. Add `poll.example.com` to the Turnstile widget's hostnames.
4. `npm run deploy`. Cloudflare creates the DNS record and certificate automatically.

The `workers.dev` hostname keeps working unless you disable it in the Worker's settings. If you do, remove
it from the Turnstile widget too.

## Continuous deployment (optional)

A minimal GitHub Actions job:

```yaml
name: deploy
on: { push: { branches: [main] } }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm test
      - run: npx playwright install --with-deps chromium
      - run: cp .dev.vars.example .dev.vars # test keys for the local Worker the browser tests use
      - run: npm run test:e2e
      - run: npm run db:migrate:remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

Create the API token in the dashboard with the "Edit Cloudflare Workers" template plus D1 edit
permission. Worker secrets set with `wrangler secret put` persist across deploys and do not need to be in
CI.

## Troubleshooting

| Symptom                                                | Likely cause                                                                                                          | Fix                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `You are not authenticated`                            | no wrangler login on this machine                                                                                     | `npx wrangler login`                                                      |
| Deploy fails mentioning the D1 `database_id`           | placeholder id still in `wrangler.jsonc`                                                                              | run step 1                                                                |
| `no such table: events` in production                  | migrations not applied remotely                                                                                       | `npm run db:migrate:remote`                                               |
| Every poll creation fails with `captcha_failed`        | widget hostname list does not include this host, or secret does not match site key                                    | fix widget hostnames; re-put the secret                                   |
| Turnstile widget shows a configuration error           | `VITE_TURNSTILE_SITE_KEY` empty in `.env.production` at build time                                                    | set it and redeploy                                                       |
| A creation fails with `ticket_invalid` once in a while | the client's address changed between asking for the ticket and creating, say a phone moving from Wi-Fi to mobile data | expected: tickets are bound to the client address, and trying again works |
| `429` while testing                                    | you hit the per-IP limits                                                                                             | wait a minute, or raise limits in `wrangler.jsonc`                        |
| `/e/:id` returns 404 HTML in production                | `not_found_handling` missing from assets config                                                                       | restore it and redeploy                                                   |
| Styles or fonts blocked in the browser console         | CSP changed without updating `vite.config.ts`                                                                         | add the origin to the policy                                              |
| Cron never runs                                        | trigger removed from config, or Worker not deployed since adding it                                                   | check Settings → Triggers; redeploy                                       |
| Type errors after editing `wrangler.jsonc`             | stale `worker-configuration.d.ts`                                                                                     | `npm run cf-typegen`                                                      |

## Tests to run before a deploy

```sh
npm run lint        # ESLint: TypeScript rules, rules of hooks and jsx-a11y; CI runs this and the format check first
npm run format:check
npm test            # unit tests under Node, then the whole Worker inside workerd with a local D1
npm run test:e2e    # browser journeys with Playwright; starts `npm run dev` if nothing is on :5173
```

The Worker tests cover every endpoint: ticket age and binding, replay protection, Turnstile hostname and
action checks (siteverify is stubbed, so no network), ownership rules, nickname and date uniqueness
including the concurrent case, caps, expiry recalculation, rate limiting by client and by IPv6 /64, the
body limit, response headers, and the purge. The browser tests create and answer polls with the Turnstile
test keys, so they do need network access to `challenges.cloudflare.com`. Run
`npx playwright install chromium` once per machine.
