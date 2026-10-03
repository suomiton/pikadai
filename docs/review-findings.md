# Review findings

Results of a code review carried out on 2026-10-03 covering Cloudflare usage, bot mitigation, WCAG 2.1
accessibility, mobile behaviour, coding patterns and overall architecture. This is a working backlog:
tick items off in the summary table as they are fixed, and delete the file when it is empty.

Line references point at the code as it was on the review date. The review was static; the typecheck
and build were not run.

Severity: **high** means a user-facing failure or a privacy or security gap, **medium** means a real
defect with a workaround or a WCAG AA failure, **low** means hygiene.

## Summary

| Done | ID | Severity | Finding |
| --- | --- | --- | --- |
| [x] | S1 | high | Workers Logs may record token headers and client IPs |
| [x] | S2 | high | No request body size limit on the API |
| [x] | S3 | medium | Nickname uniqueness is a read-then-write race |
| [x] | S4 | medium | IPv6 defeats the per-IP rate limiter |
| [x] | S5 | low | X-Forwarded-For fallback is spoofable and unnecessary |
| [x] | S6 | medium | Turnstile response is under-checked |
| [x] | S7 | low | Expensive checks run before cheap ones |
| [x] | S8 | low | Creation tickets add little over the rate limiter |
| [x] | S9 | medium | Two sources of truth for the minimum creation delay |
| [ ] | S10 | medium | Google Fonts leaks visitor IPs; CSP justification is wrong |
| [x] | S11 | low | Participant and option caps are read-then-write races |
| [x] | S12 | low | CI example deploys from the wrong branch |
| [x] | A1 | high | Light theme fails AA contrast almost everywhere |
| [x] | A2 | high | Vote buttons and status text do not announce changes |
| [x] | A3 | high | Creation progress is visual only |
| [x] | A4 | medium | Creation overlay is not a working modal |
| [x] | A5 | medium | Form errors are not wired to their fields |
| [x] | A6 | medium | Focus is lost after Save, Cancel and Remove |
| [x] | A7 | medium | Calendar is hard to use with a screen reader |
| [x] | A8 | medium | Vote table lacks a caption, heading and keyboard scrolling |
| [x] | A9 | low | Reduced motion is only half honoured |
| [x] | A10 | low | CSS generated content is read aloud |
| [x] | A11 | low | Weekday names are hard-coded English |
| [x] | A12 | medium | iOS zooms the page on every input focus |
| [x] | A13 | medium | Small tap targets, tiny text and autofocus on mobile |
| [x] | A14 | low | Input focus relies on a 1px border change |
| [ ] | C1 | medium | VoteGrid has too many responsibilities |
| [ ] | C2 | medium | Busy/error handling and form markup are copy-pasted |
| [ ] | C3 | low | ISO date parsing exists three times |
| [ ] | C4 | low | The Answer type is defined twice |
| [ ] | C5 | medium | queries.ts mixes data access with domain logic |
| [ ] | C6 | low | sanitizeVotes is misnamed and over-built |
| [ ] | C7 | low | Auth helpers are coupled to the Hono context |
| [ ] | C8 | medium | Side effects run inside a React state initialiser |
| [ ] | C9 | low | Duplicate SQL for inserting an option |
| [ ] | C10 | medium | No tests and no linter |

## What is already right

Worth keeping as-is: one origin for app and API, 128-bit poll ids and 256-bit tokens stored only as
SHA-256 digests with constant-time comparison, the admin token travelling in the URL fragment, Zod schemas
shared by client and Worker, `db.batch()` for every multi-row write, the strict CSP emitted at build time,
`Cache-Control: no-store` on the API, the nightly purge, and `prefers-reduced-motion` and
`prefers-color-scheme` support in CSS. The sticky name column, the stacking copy row and the flexible
Turnstile widget are good mobile choices. `cycle`, `monthGrid`, `shiftMonth`, `computeExpiresAt` and
`verifyTicket` are clean pure functions.

## S. Cloudflare, bots and security

### S1. Workers Logs may record token headers and client IPs (high)

- Where: `wrangler.jsonc:6`, `worker/lib/auth.ts:7-8`, `src/lib/api.ts:67-70`, `worker/lib/ratelimit.ts:7`,
  `docs/architecture.md:18`, `docs/cloudflare.md:156`
- Problem: `observability.enabled` turns on invocation logs, which capture the request including headers.
  The admin and participant tokens are sent as custom headers, so they would sit in plaintext in the
  dashboard for three days per request, which breaks the "only hashes are stored" promise. The same logs
  record the connecting IP, which contradicts the comments and docs saying the IP never reaches logs.
  Not verified against a live deployment; the official docs do not list the captured fields.
- Fix: Deploy, open the admin link, and inspect that invocation in Workers Logs. If `X-Admin-Token` is
  present, either send tokens as `Authorization: Bearer …` (Cloudflare redacts that header) or set
  `observability.logs.invocation_logs` to `false` and keep only `console` output. Update the three
  privacy statements to describe what the platform actually retains.
- Done 2026-10-03: both. Cloudflare's tail docs confirm request headers are captured with only heuristic
  redaction, so tokens now travel as `Authorization: Bearer` and invocation logs are off. Not checked against
  a live deployment; the docs now describe `wrangler tail` honestly.

### S2. No request body size limit on the API (high)

- Where: `worker/lib/http.ts:29`, `worker/index.ts:12`
- Problem: `c.req.json()` parses whatever arrives before Zod sees it. A multi-megabyte body burns CPU
  time and memory on every request that reaches it.
- Fix: Add `bodyLimit({ maxSize: 16 * 1024 })` from `hono/body-limit` to the `/api/*` middleware group.

### S3. Nickname uniqueness is a read-then-write race (medium)

- Where: `worker/routes/participants.ts:49` and `:86`, `worker/db/queries.ts:185-200`,
  `migrations/0001_init.sql:17-25`, `docs/database.md:114`
- Problem: Two concurrent requests can both pass `nicknameTaken` and both insert. The docs say SQLite
  cannot enforce this because `UNIQUE` would need a `COLLATE NOCASE` column; that is wrong, collation is
  allowed per index column.
- Fix: New migration: `CREATE UNIQUE INDEX idx_participants_event_nickname ON participants (event_id,
  nickname COLLATE NOCASE)`. Keep the pre-check for the friendly error and map the UNIQUE violation to
  `nickname_taken` as a fallback, as the ticket nonce already does. Correct the paragraph in
  `docs/database.md`.

### S4. IPv6 defeats the per-IP rate limiter (medium)

- Where: `worker/lib/ratelimit.ts:19`
- Problem: The key is the full address. A single home connection owns a /64, so a bot has effectively
  unlimited keys.
- Fix: When the address contains a colon, truncate to the first four hextets before using it as the key.

### S5. X-Forwarded-For fallback is spoofable and unnecessary (low)

- Where: `worker/lib/ratelimit.ts:12`
- Problem: Cloudflare always sets `CF-Connecting-IP`; the fallback only exists to be spoofed.
- Fix: Remove it. Keep the `'unknown'` bucket for the impossible case.

### S6. Turnstile response is under-checked (medium)

- Where: `worker/lib/turnstile.ts:20-21`, `src/components/TurnstileField.tsx:28`
- Problem: Only `success` is read. A token solved on any hostname bound to the widget, for any purpose,
  is accepted anywhere.
- Fix: Compare `hostname` with the request host. Pass `action: 'create'` and `action: 'answer'` to the
  widget and require the matching `action` in the siteverify response.

### S7. Expensive checks run before cheap ones (low)

- Where: `worker/routes/events.ts:25-30`, `worker/routes/participants.ts:43-51`
- Problem: Creation calls siteverify before the local HMAC ticket check. Answering spends the Turnstile
  token before the participant cap and nickname checks. Every failed check consumes a token and forces the
  user to re-solve.
- Fix: Order each handler as parse, local checks, database reads, Turnstile, write.

### S8. Creation tickets add little over the rate limiter (low)

- Where: `worker/lib/tickets.ts`, `worker/routes/tickets.ts:9`, `src/pages/CreatePage.tsx:22`
- Problem: A bot waits five seconds and proceeds; the create limiter already allows five per minute per
  IP. Tickets are not bound to the requesting IP, so they can be harvested from one address and spent from
  others.
- Fix: A judgment call. Either accept it as UI choreography and say so in `docs/architecture.md`, or bind
  the ticket to the IP hash in the signed payload so harvesting stops working. Removing the scheme
  entirely would also be defensible.
- Done 2026-10-03: bound to the rate-limit key (IPv4 address or IPv6 /64) inside the HMAC input, and the
  residual value of the scheme is stated in `docs/architecture.md`.

### S9. Two sources of truth for the minimum creation delay (medium)

- Where: `worker/routes/events.ts:28`, `src/pages/CreatePage.tsx:22`, `shared/limits.ts:9`,
  `wrangler.jsonc` `vars`
- Problem: The Worker reads `MIN_CREATE_DELAY_MS` while the client hard-codes `LIMITS.minCreateDelayMs`.
  Raising the var breaks every creation with `ticket_too_early`; the deployment doc has to warn about it.
- Fix: Return `{ ticket, notBefore }` from `POST /api/tickets` and have the client wait until `notBefore`.
  Then delete the var or the constant so one remains.
- Done 2026-10-03: the response carries a relative `minAgeMs` rather than an absolute `notBefore`, because
  the client clock cannot be trusted against the server's. The var is gone; `LIMITS.minCreateDelayMs` remains.

### S10. Google Fonts leaks visitor IPs; CSP justification is wrong (medium)

- Where: `index.html:10-12`, `vite.config.ts:16`, `docs/architecture.md:176`
- Problem: Every visitor's IP and referrer go to Google, which sits badly with "no tracking" and has GDPR
  exposure in the EU. The docs justify `style-src 'unsafe-inline'` with React inline style props, but the
  code has none.
- Fix: Iosevka is OFL. Self-host the three weights under `public/fonts/`, remove the two font origins from
  the CSP and the preconnects. Then test whether Turnstile still needs `'unsafe-inline'` for styles; if it
  does, document that as the real reason.
- Decision 2026-10-03: left open on purpose. Google Fonts stays and the IP exposure is accepted; only the
  wrong CSP justification in `docs/architecture.md` was corrected.

### S11. Participant and option caps are read-then-write races (low)

- Where: `worker/routes/participants.ts:46`, `worker/routes/options.ts:24`
- Problem: Concurrent requests can exceed the caps by a few rows.
- Fix: Acceptable at this scale. If it matters, do the count inside the batch with a conditional insert,
  or re-check after insert and roll back.
- Done 2026-10-03: accepted; the overshoot is documented in `docs/architecture.md` and `docs/database.md`.

### S12. CI example deploys from the wrong branch (low)

- Where: `docs/deployment.md:197`
- Problem: The GitHub Actions snippet triggers on `master`; the repository branch is `main`.
- Fix: Change to `main`.

## A. Accessibility (WCAG 2.1) and mobile

### A1. Light theme fails AA contrast almost everywhere (high)

- Where: `src/styles/tokens.css:49-81` (light), `tokens.css:38` (`--no`), `tokens.css:20` (`--border`),
  `tokens.css:24` (`--text-faint`)
- Problem: Ratios computed from the token values. AA needs 4.5:1 for text and 3:1 for component
  boundaries. Bold text under 18.66px and regular text under 24px do not count as large.

| Pair | Dark | Light | Used by |
| --- | --- | --- | --- |
| Faint text on card | 3.6 | 2.9 | `.hint`, `.opt-year`, `.calendar-weekday` |
| Faint text on page | 4.6 | 2.7 | `.meta`, `.site-footer` |
| "No" glyph on card | 1.9 | n/a | `.vote-cell.is-no` |
| "No" glyph on vote button | 2.5 | n/a | `.vote-btn` |
| "Yes" glyph on card | 7.9 | 2.7 | `.vote-cell.is-yes` |
| "Maybe" glyph on vote button | 4.7 | 1.8 | `.vote-btn` |
| Primary button text | 7.9 | 3.8 | `.btn-primary` |
| Primary button text on hover | ok | 2.1 | `.btn-primary:hover` |
| Accent on card | 7.9 | 3.8 | links, `.is-today`, `.tally strong` |
| Error text on card | 4.1 | 5.2 | `.field-error`, `.form-error` |
| Input border against its fill | 1.8 | 1.2 | `.input` |
| Input fill against the card | 1.3 | 1.1 | `.input` |

- Fix: For light mode, pick a darker gold for text and glyph use (around `#8a4f12` reaches 4.5:1 on the
  cream card) and keep the bright golds for backgrounds only. Give the "no" glyph its own token that is
  not the violet in dark mode. Darken `--danger` slightly in dark mode. Give inputs a border with at least
  3:1 against the card in both themes. Re-run the ratios after changing tokens; a small script that
  prints them belongs in `scripts/`.

### A2. Vote buttons and status text do not announce changes (high)

- Where: `src/components/VoteGrid.tsx:188-196`, `src/components/CopyField.tsx:36`,
  `src/components/VoteGrid.tsx:354`
- Problem: Tapping a cell cycles four states but only the `aria-label` changes, which assistive tech does
  not re-read on the focused element. "Copied" and "Saving" change button text silently. WCAG 4.1.3.
- Fix: Add one visually hidden `role="status"` element per editing panel and write "Thursday 15 October:
  if need be" into it on each toggle. Do the same for copy and save states. A radio group per cell would
  be the fully accessible alternative to cycling.

### A3. Creation progress is visual only (high)

- Where: `src/components/ProgressSteps.tsx:24-45`
- Problem: The `aria-live` list wraps labels that never change; only hidden icons and classes change, so
  screen-reader users hear nothing between submit and success. WCAG 1.3.1, 4.1.3.
- Fix: Render visually hidden text such as "Step 2 of 4, Setting up" inside the live region and put
  `aria-current="step"` on the active item.

### A4. Creation overlay is not a working modal (medium)

- Where: `src/pages/CreatePage.tsx:175-193`
- Problem: `role="dialog"` and `aria-modal` are set, but focus never moves into the dialog, is not
  trapped, and the form behind is not inert. The "Back to the form" button is unreachable without
  tabbing through the page. WCAG 2.4.3.
- Fix: Use a native `<dialog>` opened with `showModal()`. That gives focus movement, trapping, Escape and
  an inert background for free.

### A5. Form errors are not wired to their fields (medium)

- Where: `src/pages/CreatePage.tsx:114`, `:129`, `:147`, `src/components/AdminPanel.tsx:36`
- Problem: Field errors sit inside the label with no `aria-invalid` or `aria-describedby`; the dates error
  has no control to attach to; focus stays on the submit button, so a screen-reader user who only has a
  title error hears nothing. WCAG 3.3.1, 4.1.2.
- Fix: Give each error an id, set `aria-describedby` and `aria-invalid` on the input, give the calendar a
  `role="group"` with `aria-labelledby` and `aria-describedby`, and move focus to the first invalid field
  on submit.

### A6. Focus is lost after Save, Cancel and Remove (medium)

- Where: `src/components/VoteGrid.tsx:84`, `:131`, `:156`, `src/components/SuggestDate.tsx:37`,
  `src/components/AdminPanel.tsx:43`
- Problem: The editing row or panel unmounts and focus falls to `<body>`. WCAG 2.4.3.
- Fix: Keep a ref to the button that opened the editor and focus it when the editor closes.

### A7. Calendar is hard to use with a screen reader (medium)

- Where: `src/components/Calendar.tsx:32`, `:45`, `:70`
- Problem: Day buttons are labelled with the raw ISO string, read as digits. The weekday row is hidden.
  Paging months changes the title silently. WCAG 1.3.1, 4.1.2.
- Fix: Label each day with `formatDate(iso, { weekday: 'long', day: 'numeric', month: 'long', year:
  'numeric' })`. Make the title an `aria-live="polite"` heading and reference it from the grid with
  `aria-labelledby`. A roving `tabindex` with arrow keys would reduce the tab stops from thirty-plus to one.

### A8. Vote table lacks a caption, heading and keyboard scrolling (medium)

- Where: `src/components/VoteGrid.tsx:211-213`
- Problem: The section has no heading, the table has no caption, and the horizontal scroll container
  cannot receive keyboard focus. WCAG 1.3.1, 2.1.1.
- Fix: Add an `<h2>` (visually hidden if preferred) and a `<caption class="visually-hidden">`. Give
  `.table-scroll` `tabIndex={0}`, `role="region"` and an `aria-label`.

### A9. Reduced motion is only half honoured (low)

- Where: `src/components/ProgressSteps.tsx:17`
- Problem: CSS animations stop under `prefers-reduced-motion`, but the JavaScript spinner keeps ticking.
- Fix: Check `matchMedia('(prefers-reduced-motion: reduce)')` and skip the interval, showing a static glyph.

### A10. CSS generated content is read aloud (low)

- Where: `src/styles/base.css:40-43`, `src/styles/components.css:17-20`, `:209-212`
- Problem: VoiceOver reads the `## `, `> ` and `! ` prefixes.
- Fix: Use the alternative-text syntax, for example `content: '## ' / ''`.

### A11. Weekday names are hard-coded English (low)

- Where: `src/lib/dates.ts:1`
- Problem: Every other date uses the user's locale through `Intl`, so a Finnish user sees "Mon" beside
  "3. lokak.".
- Fix: Build the weekday labels with `Intl.DateTimeFormat(undefined, { weekday: 'short' })` over a known
  Monday-to-Sunday week.

### A12. iOS zooms the page on every input focus (medium)

- Where: `src/styles/base.css:18`, `src/styles/components.css:181-184`
- Problem: Safari on iOS zooms when a focused input has a font size under 16px. Body text is 15px and
  `.input-sm` is smaller.
- Fix: Set `font-size: max(16px, 1em)` on `.input`, or set it to 16px under the mobile media query.

### A13. Small tap targets, tiny text and autofocus on mobile (medium)

- Where: `src/styles/components.css:238-245` (chip button), `:418-422` (`.opt-tag`), `:273-278`
  (`.calendar-weekday`), `:423-427` (option remove button), `src/pages/CreatePage.tsx:112`
- Problem: The chip remove button is about 16 by 20px; the option remove button is just under 26px.
  WCAG 2.2 AA requires 24px and 2.1 AAA requires 44px. The "suggested" tag renders at roughly 10px and
  the weekday and year labels at roughly 11px. Autofocus on the title pops the keyboard on load and
  scrolls the hero out of view.
- Fix: Give small buttons a minimum 44px hit area with padding or a pseudo-element. Lift the smallest
  text to at least 0.75rem. Drop the autofocus on the create page; keep it on the nickname input, where
  it is a deliberate focus move.

### A14. Input focus relies on a 1px border change (low)

- Where: `src/styles/components.css:177-180`
- Problem: `outline: none` on focus leaves only a border colour change as the indicator.
- Fix: Keep the global `:focus-visible` outline, or thicken the border to 2px and ensure 3:1 against the
  surroundings.

## C. Code patterns and architecture

### C1. VoteGrid has too many responsibilities (medium)

- Where: `src/components/VoteGrid.tsx` (380 lines)
- Problem: Tallies, the editing state machine, four API mutations, Turnstile, confirm dialogs and all
  rendering live in one component.
- Fix: Extract a pure `computeTallies(event)` into `src/lib/`, a `VoteRow` component, an `OptionHeader`
  component and an `EditPanel`. Keep the state machine in a `useVoteEditor` hook.

### C2. Busy/error handling and form markup are copy-pasted (medium)

- Where: `src/components/AdminPanel.tsx:39-49`, `src/components/SuggestDate.tsx:32-43`,
  `src/components/VoteGrid.tsx:111-140`, `:148-162`, `:169-178`; error paragraphs in eight places;
  label-input-error markup in `CreatePage` and `AdminPanel`
- Problem: The same `setBusy / setError / try / catch / finally` block appears six times, the error
  paragraph eight times, and field markup twice.
- Fix: A `useAsyncAction()` hook returning `{ run, busy, error }`, a `<FormError message />` component,
  and a `<TextField>` that owns label, input, error and the `aria-*` wiring from A5.

### C3. ISO date parsing exists three times (low)

- Where: `shared/schemas.ts:5`, `src/lib/dates.ts:16`, `worker/db/queries.ts:45`
- Fix: One `parseIsoParts(iso): [y, m, d]` in `shared/dates.ts`, used by all three.

### C4. The Answer type is defined twice (low)

- Where: `shared/types.ts:1`, `shared/schemas.ts:15`
- Fix: `export type Answer = z.infer<typeof answerSchema>` and delete the literal union.

### C5. queries.ts mixes data access with domain logic (medium)

- Where: `worker/db/queries.ts:42` (`computeExpiresAt`), `:276` (`buildEventView`)
- Problem: Pure expiry maths and the row-to-view mapping sit in the SQL module, so neither is testable
  without a database and the module has two reasons to change.
- Fix: Move `computeExpiresAt` to `shared/expiry.ts` or `worker/lib/expiry.ts`. Split `buildEventView`
  into `fetchEventRows(db, id)` and a pure `toEventView(rows, isAdmin)`.

### C6. sanitizeVotes is misnamed and over-built (low)

- Where: `worker/routes/participants.ts:24-37`, `docs/architecture.md` "drops votes"
- Problem: It rejects rather than drops, its comment and the docs say otherwise, and it copies the object
  for no reason.
- Fix: Rename to `assertVotesBelongToEvent`, find the first unknown id and throw, return the input.
  Fix the two descriptions.

### C7. Auth helpers are coupled to the Hono context (low)

- Where: `worker/lib/auth.ts:20`, `:31`
- Fix: Accept the header value and the row; let the route read the header. The helpers become pure
  async functions that tests can call directly.

### C8. Side effects run inside a React state initialiser (medium)

- Where: `src/pages/EventPage.tsx:18-29`
- Problem: The initialiser writes `localStorage` and rewrites history during render, and never re-runs
  if the route id changes while the component stays mounted.
- Fix: Move the capture into a `useEffect` keyed on `id`, or into a React Router loader.

### C9. Duplicate SQL for inserting an option (low)

- Where: `worker/db/queries.ts:78`, `:132`
- Fix: One `optionInsert(db, option)` statement builder used by both.

### C10. No tests and no linter (medium)

- Where: repository root
- Problem: `docs/deployment.md` describes a manual smoke script; nothing runs automatically. Several
  items in section A would have been caught mechanically.
- Fix: Vitest with `@cloudflare/vitest-pool-workers` for the Worker and plain Vitest for `shared/` and
  `src/lib/`. Start with `verifyTicket`, `computeExpiresAt`, `monthGrid`, `cycle` and the tallies. Add
  ESLint with `eslint-plugin-jsx-a11y` and `eslint-plugin-react-hooks`, plus Prettier, and run all of it
  in the `build` script or a CI job.
- Partly done 2026-10-03: tests exist at three levels (`npm test`, `npm run test:e2e`; see
  `docs/project-structure.md`), and `cycle` plus the tallies moved to `src/lib/votes.ts` to make that
  possible, which is a first slice of C1. The linter and formatter are still open.
