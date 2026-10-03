# Architecture

Pikadai is an anonymous date-poll service. Someone creates a poll, shares one link, and people answer with
a nickname. There are no accounts, no email, no cookies, and polls delete themselves after they expire.

This document explains how the system is put together and why. For the pieces it refers to, see:

- [Cloudflare services](cloudflare.md) for the platform features in use
- [Database](database.md) for the schema and data lifecycle
- [Project structure](project-structure.md) for where the code lives
- [Deployment](deployment.md) for getting it live

## Goals and constraints

| Goal | How it shapes the design |
| --- | --- |
| Zero hosting cost | Everything runs on Cloudflare's free plan: Workers, static assets, D1, Turnstile, cron. |
| Anonymous by design | No personal data is stored. The IP address is used only as a transient rate-limit key. |
| Abuse-resistant without identity | Layered controls: Turnstile, rate limits, server-enforced creation delay, hard size limits. |
| Backend stays unexposed | The API lives on the same origin as the page, has no listing endpoints, and uses unguessable capability URLs. |
| Simple operations | One Worker, one deploy command, no servers to patch. |

## High-level design

```
 Browser ──── HTTPS ────▶ Cloudflare edge (one hostname)
                           │
                           ├── Static Assets ─── React SPA + _headers      ◀ every path except /api/*
                           │
                           └── Worker (Hono) ─── /api/*
                                 ├── D1 (SQLite)                 polls, dates, answers
                                 ├── Rate-limit bindings         in-memory, per IP
                                 ├── Turnstile siteverify        outbound HTTPS to Cloudflare
                                 └── Cron trigger                nightly purge of expired polls
```

The SPA and the API share one hostname. That removes CORS entirely and means there is no separately
discoverable API host. Requests for `/api/*` always reach the Worker because of `run_worker_first` in
`wrangler.jsonc`; everything else is served from the asset store, with unknown paths falling back to
`index.html` so the client-side router can handle them.

## Components

**Frontend** (`src/`). React 19 with `react-router`. The event page fetches a single `EventView` JSON
document and re-fetches it after every mutation; there is no client-side cache or websocket. Forms are
validated with the same zod schemas the Worker uses, so users get instant feedback and the server still
has the final say. Tokens are kept in `localStorage`; see [Trust model](#trust-model-and-identity).

**Worker** (`worker/`). A Hono application. Each route file owns one resource. Cross-cutting concerns live
in `worker/lib/`: token hashing and constant-time comparison, creation tickets, Turnstile verification,
rate limiting, and a typed `HttpError` that the global error handler turns into `{ error, code, details }`
JSON. Database access is isolated in `worker/db/queries.ts` so route handlers never contain SQL.

**Shared** (`shared/`). Zod schemas, the `LIMITS` constant, and the response types. Imported by both sides
through the `@shared/*` path alias. Changing a limit here changes the form, the API, and the error messages
at once.

**Database**. Cloudflare D1, which is SQLite. Four tables. Described in [database.md](database.md).

## Trust model and identity

There are no users, only three kinds of capability tokens. None is stored in plaintext; the database holds
SHA-256 digests, and comparisons use `crypto.subtle.timingSafeEqual`.

| Token | Bits | Who holds it | Where it travels | What it allows |
| --- | --- | --- | --- | --- |
| Poll id | 128 | anyone with the link | URL path `/e/:id` | read the poll, add an answer, suggest a date |
| Admin token | 256 | the creator | URL fragment on first visit, then `localStorage`; header `X-Admin-Token` | edit or delete the poll, any answer, any date |
| Edit token | 256 | each participant | `localStorage`; headers `X-Participant-Token` + `X-Participant-Id` | edit or remove their own answer |

**Why the fragment.** The admin link is `/e/:id#admin=TOKEN`. Browsers never send the fragment to the
server, so the token does not appear in edge logs or referrers. On first load the page copies it into
`localStorage` and rewrites the address bar without it, so a screenshot or a copied URL afterwards does
not leak it. There is no recovery path if the admin link is lost; that is the price of having no accounts,
and the UI says so next to the link.

**Why hashes.** A database leak would expose nothing usable: poll ids are public anyway, and the hashes
cannot be inverted into tokens.

**Who can do what** is decided entirely on the server. The `viewer.isAdmin` flag in `EventView` only
controls what the UI shows; every admin route re-verifies the header.

## Request flows

### Creating a poll

```mermaid
sequenceDiagram
    participant U as Browser
    participant W as Worker
    participant T as Turnstile
    participant D as D1

    U->>U: validate draft with eventDraftSchema
    U->>W: POST /api/tickets
    W-->>U: { ticket }  (HMAC-signed, timestamped)
    Note over U: progress steps play for ≥ 5.8 s
    U->>W: POST /api/events { draft, ticket, turnstileToken }
    W->>W: rate limit CREATE_LIMITER (5/min per IP)
    W->>W: validate with createEventSchema
    W->>T: siteverify(turnstileToken)
    T-->>W: success
    W->>W: verify ticket: signature, age ≥ MIN_CREATE_DELAY_MS, age ≤ 15 min
    W->>D: batch insert event + options (ticket nonce UNIQUE)
    D-->>W: ok
    W-->>U: 201 { id, adminToken }
    U->>U: store admin token, navigate to /e/:id
```

The "artificial delay" is enforced server-side, not just drawn on screen. A ticket is
`<issuedAtMs>.<nonce>.<hmac>`; the Worker signs it with `TICKET_SECRET` and will not accept a poll until
the ticket is at least `MIN_CREATE_DELAY_MS` old. The nonce is written to `events.ticket_nonce`, which has
a UNIQUE index, so a ticket cannot be replayed. The client's step timings in `src/pages/CreatePage.tsx`
end at 5.8 s to leave headroom above the 5 s minimum.

### Answering a poll

1. `GET /api/events/:id` returns the full view: options, participants, votes, and `viewer.isAdmin`.
2. The user picks a nickname and taps cells; the Turnstile widget produces a token.
3. `POST /api/events/:id/participants` verifies Turnstile, checks the participant cap and nickname
   uniqueness (case-insensitive within the poll), drops votes for unknown options, and inserts the row and
   its votes atomically.
4. The response `{ id, editToken }` is stored in `localStorage` under the poll id. Later edits send both
   as headers to `PUT /api/events/:id/participants/:participantId`.

A vote is one of `yes`, `maybe`, `no`. A missing vote means "no answer" and is shown as `·`. Each save
replaces the participant's whole vote set, which keeps the client logic simple and avoids partial updates.

### Suggesting a date

Any reader may `POST /api/events/:id/options` while `allow_suggestions` is on. If the request carries a
valid participant token, the option records `suggested_by` so the UI can tag it. The admin may add dates
regardless of the setting, and only the admin may delete a date. Adding or removing a date recomputes the
poll's expiry.

### Expiry and deletion

`expires_at` is midnight UTC after the last date option plus 30 days, or creation plus 90 days when a poll
has no dates. Reads of an expired poll return `410 Gone` even before the purge runs. A cron trigger fires
daily at 03:17 UTC and deletes expired events; foreign keys cascade to options, participants, and votes.
Admins can delete a poll at any time with the same cascade.

## Abuse controls

The controls are layered so no single one has to be perfect.

| Control | Stops | Where |
| --- | --- | --- |
| Turnstile on creation and first answer | bulk scripted creation and vote stuffing | `worker/lib/turnstile.ts`, `src/components/TurnstileField.tsx` |
| Per-IP rate limits (5 creates, 40 writes, 120 reads per minute) | floods from one source | `worker/lib/ratelimit.ts`, `wrangler.jsonc` |
| Creation tickets with a 5 s minimum age, single use | parallel mass creation even with a solved CAPTCHA | `worker/lib/tickets.ts` |
| Hard limits: 100-char title, 500-char description, 32-char nickname, 40 dates, 100 participants | storage abuse and spam text | `shared/limits.ts`, enforced in schemas and route handlers |
| Unique nickname per poll | impersonation within a poll | `participants` route |
| Vote set replaced per save, unknown option ids rejected | orphan or forged votes | `participants` route |
| Expiry plus nightly purge | indefinite hosting of junk | `worker/index.ts` `scheduled` handler |

What is deliberately **not** done: browser fingerprinting, persistent IP storage, or email verification.
Each would undermine the anonymity promise, and the controls above are sufficient for a free hobby service.

## Transport security and headers

Static assets are served with a strict `Content-Security-Policy` and companion headers from a `_headers`
file. The file is generated at build time by a small Vite plugin in `vite.config.ts` rather than kept in
`public/`, because its `script-src` would block the inline React Fast Refresh preamble in development.

```
default-src 'self'
script-src  'self' https://challenges.cloudflare.com
frame-src   https://challenges.cloudflare.com
style-src   'self' 'unsafe-inline' https://fonts.googleapis.com
font-src    https://fonts.gstatic.com
connect-src 'self'
frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
```

`'unsafe-inline'` for styles is needed for React's inline `style` props and the Google Fonts stylesheet; it
does not weaken script execution. The API adds `Cache-Control: no-store` and `X-Content-Type-Options:
nosniff` to every response.

## API reference

All request and response bodies are JSON. Errors are `{ error: string, code: string, details?: unknown }`.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/tickets` | none | Issue a creation ticket |
| POST | `/api/events` | Turnstile + ticket | Create a poll → `{ id, adminToken }` |
| GET | `/api/events/:id` | optional `X-Admin-Token` | Full poll view with `viewer.isAdmin` |
| PATCH | `/api/events/:id` | admin | Change title, description, `allowSuggestions` |
| DELETE | `/api/events/:id` | admin | Delete poll and everything in it |
| POST | `/api/events/:id/options` | anyone while suggestions are on; admin always | Add a date |
| DELETE | `/api/events/:id/options/:optionId` | admin | Remove a date and its votes |
| POST | `/api/events/:id/participants` | Turnstile | Add an answer → `{ id, editToken }` |
| PUT | `/api/events/:id/participants/:participantId` | own token or admin | Replace nickname and votes |
| DELETE | `/api/events/:id/participants/:participantId` | own token or admin | Remove an answer |

Error codes the client maps to messages (`src/lib/errors.ts`):

`invalid_json`, `validation_failed`, `captcha_failed`, `ticket_invalid`, `ticket_too_early`,
`ticket_expired`, `ticket_used`, `rate_limited`, `not_found`, `expired`, `admin_required`,
`suggestions_disabled`, `too_many_options`, `date_exists`, `event_full`, `nickname_taken`,
`unknown_option`, `not_owner`, `internal`.

## Key decisions and trade-offs

**TypeScript on the Worker instead of C# or Rust.** Workers is TypeScript-first, and sharing zod schemas
between client and server removes a whole class of drift bugs. Rust via WebAssembly would also run on
Workers but with a thinner ecosystem; C# has no comparable free host.

**Same-origin static assets instead of GitHub Pages.** GitHub Pages would have required a public API
hostname and CORS. Workers static assets are free, serve the SPA fallback natively, and let the API hide
behind the same hostname.

**Server-enforced delay instead of a client-only wait.** A client-side timer is trivially skipped by a
script. The ticket scheme costs one extra request and a few lines of HMAC code, and makes the delay real.

**Dates only, no time slots.** Timezones are the main source of bugs in scheduling tools. The schema can
grow `start_time` and `end_time` columns on `options` later without changing anything else.

**Unique nickname per poll.** Doodle allows duplicates, which is confusing in a small group. Case-insensitive
uniqueness within one poll costs one query and prevents accidental impersonation.

**`localStorage` instead of cookies.** Cookies would be sent on every request and would require a consent
banner in the EU. `localStorage` is strictly necessary for the service to function and never leaves the
browser.

**Rate limiting is approximate.** The Workers rate-limit binding counts per Cloudflare location, not
globally, and its state lives in memory. That is fine here: the goal is to blunt floods, and D1 limits on
participants and options per poll bound the damage regardless.

**Full re-fetch after every mutation.** Simpler than optimistic updates or a store, and polls are small.
Revisit if a poll view ever grows beyond a few kilobytes.

## Non-goals and future work

Not planned: accounts, email notifications, comments, or integrations with calendars. Reasonable next
steps: time slots per date, a "hide results until I answer" option, exporting the chosen date as an `.ics`
file, and an automated test suite seeded from the smoke test described in [deployment.md](deployment.md).
