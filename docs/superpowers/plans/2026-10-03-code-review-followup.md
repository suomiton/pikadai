# Code review follow-up (2026-10-03) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close findings 1–8 of `docs/code-review-2026-10-03.md` (two data-loss races, three
credential-loss paths, a draft-loss path, CI and coverage gaps) plus the Turnstile timeout, without
changing what the poll looks like or how it is used.

**Architecture:** The Worker computes `expires_at` inside the same D1 batch as the option change, in
SQL, so no JavaScript snapshot can go stale. The client's poll actions take the poll id explicitly and
discard superseded fetch results; the root reducer keeps a loaded event through a transient refresh
failure and only drops it when the server says the poll is gone. The vote editor prunes draft votes for
removed dates. CI gains the production build, the browser suite and a coverage run.

**Tech Stack:** Cloudflare Workers (Hono, D1), React 19 with `useReducer` + context, Vitest 4 with
`@cloudflare/vitest-pool-workers`, Playwright, GitHub Actions.

**Spec:** `docs/code-review-2026-10-03.md` (the review itself is the spec; each finding has a
"Recommended fix" and "Regression coverage" paragraph this plan implements).

**Branch:** `fix/code-review-2026-10-03` in the worktree `.worktrees/fix-code-review-2026-10-03`, off
`main` at `0f12a17`. The main checkout holds uncommitted, in-progress work (a `ConfirmDialog`/`Modal`
replacing `window.confirm` in `VoteGrid`, `AdminPanel` and `CreatePage`). This branch does not include
it; the merge will conflict in `VoteGrid.tsx` and `AdminPanel.tsx` around `remove`, `removeOption` and
`destroy`, and `e2e/poll.spec.ts` must then switch its new tests from `page.once('dialog', …)` to the
`alertdialog` role.

## Assumptions (the session runs autonomously; a reviewer can overturn any of these)

1. Fixes are committed per finding on the branch; nothing is pushed and no PR is opened.
2. No React rendering library is added (decision kept from the 2026-10-03 client-state design). React
   scheduling and draft lifetime are covered by Playwright journeys; pure logic by Vitest.
3. The "maximum scheduling horizon" recommendation is **not** implemented: it is a product rule that
   also needs a `maxDate` in the `Calendar`, so it is listed as an open decision instead.
4. Coverage thresholds are set a few points under the measured values, so they catch regressions
   without demanding new tests for untouched code.

## Global Constraints

- Copy, roles, labels and focus behaviour stay the same except where a finding changes them (the
  `unknown_option` message, the new refresh banner and storage notice).
- Prettier: single quotes, 120 columns, trailing commas. ESLint flat config must pass (`npm run lint`).
- Every pure module keeps an injected-dependency or pure-function shape so it runs under Node.
- `npm run build` must stay green: `tsc -b` with `noUnusedLocals`/`noUnusedParameters`.
- D1 batches are the only transaction mechanism; a value computed in JavaScript must never be written
  into a batch when it depends on rows the batch also changes.

## Review Focus

1. Two `POST /options` for the same poll racing: `expires_at` must equal the expiry of the union of dates
   whichever finishes last. (Task 1 test: concurrent adds through `SELF.fetch`.)
2. A refresh that resolves after a newer refresh must not change state or storage. (Task 2 test: two
   `getEvent` promises resolved in reverse order with a participant created between them.)
3. An answer saved for poll A that completes after navigating to poll B must store A's token under A and
   leave B's identity alone. (Task 2 test.)
4. Blocked `localStorage` at creation time must still open the poll as the organiser. (Task 3 test:
   `CreatePage` navigates with the admin fragment; `openPoll` keeps in-memory credentials when storage
   returns nothing.)
5. A date removed under an open draft must not make Save fail; the nickname and the other votes stay.
   (Task 4 e2e test.)

---

### Task 1: Expiry computed in SQL inside the option batch (finding 1)

**Files:**

- Modify: `worker/db/queries.ts` (`insertOption`, `deleteOption`; delete `refreshExpiry`)
- Modify: `worker/routes/options.ts` (drop the `refreshExpiry` calls; pass `now` to `deleteOption`)
- Create: `worker/test/queries.test.ts`
- Modify: `worker/test/options.test.ts` (concurrent adds)
- Modify: `docs/database.md` (expiry paragraph)

**Interfaces:**

- Produces: `insertOption(db, option): Promise<void>` (unchanged signature, now a batch) and
  `deleteOption(db, eventId, optionId, now): Promise<boolean>` (gains `now`).
- `computeExpiresAt` in `worker/lib/expiry.ts` stays for poll creation; the SQL below is the same rule.

- [x] **Step 1: Write the failing tests** (`worker/test/queries.test.ts`)

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '@shared/limits';
import { deleteOption, getEventRow, insertOption } from '../db/queries';
import { computeExpiresAt } from '../lib/expiry';
import { insertEventRow } from './helpers';

const DAY = 24 * 60 * 60 * 1000;
let n = 0;
const option = (eventId: string, date: string) => ({
  id: `opt-${eventId}-${++n}`,
  event_id: eventId,
  date,
  suggested_by: null,
  created_at: Date.now(),
});

describe('option writes keep expires_at in step with the rows', () => {
  it('recomputes the expiry from every option after each insert, whatever the order', async () => {
    const id = `q-insert-${Date.now()}`;
    const createdAt = Date.UTC(2026, 9, 3);
    await insertEventRow({ id, created_at: createdAt, expires_at: createdAt + LIMITS.ttlWithoutDatesDays * DAY });
    await insertOption(env.DB, option(id, '2026-11-28'));
    await insertOption(env.DB, option(id, '2026-11-21')); // earlier date added later
    const row = await getEventRow(env.DB, id);
    expect(row?.expires_at).toBe(computeExpiresAt(['2026-11-21', '2026-11-28'], createdAt));
  });

  it('falls back to the creation TTL once the last date is removed', async () => {
    const id = `q-delete-${Date.now()}`;
    const createdAt = Date.UTC(2026, 9, 3);
    await insertEventRow({ id, created_at: createdAt, expires_at: 0 });
    const only = option(id, '2026-11-21');
    await insertOption(env.DB, only);
    expect(await deleteOption(env.DB, id, only.id, createdAt + DAY)).toBe(true);
    const row = await getEventRow(env.DB, id);
    expect(row?.expires_at).toBe(computeExpiresAt([], createdAt));
    expect(row?.updated_at).toBe(createdAt + DAY);
  });

  it('reports false and leaves the expiry alone for an option that is not in the poll', async () => {
    const id = `q-miss-${Date.now()}`;
    const createdAt = Date.UTC(2026, 9, 3);
    await insertEventRow({ id, created_at: createdAt, expires_at: 0 });
    await insertOption(env.DB, option(id, '2026-11-21'));
    expect(await deleteOption(env.DB, id, 'nope', createdAt)).toBe(false);
    expect((await getEventRow(env.DB, id))?.expires_at).toBe(computeExpiresAt(['2026-11-21'], createdAt));
  });
});
```

And in `worker/test/options.test.ts`, a concurrent case:

```ts
it('keeps the expiry right when two dates are added at the same time', async () => {
  const poll = await createPoll();
  const dates = [futureIso(60), futureIso(45)];
  const results = await Promise.all(dates.map((date) => client().post(`/api/events/${poll.id}/options`, { date })));
  expect(results.map((r) => r.status)).toEqual([201, 201]);
  const view = await getView(poll.client, poll.id);
  expect(view.expiresAt).toBe(
    computeExpiresAt(
      view.options.map((o) => o.date),
      view.createdAt,
    ),
  );
});
```

- [x] **Step 2: Run them**: `npx vitest run --project worker worker/test/queries.test.ts` — fails: the first
      test gets the expiry of the later insert only, `deleteOption` has no `now`.

- [x] **Step 3: Implement** in `worker/db/queries.ts`

```ts
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Recompute expires_at from the option rows as this transaction sees them. Same rule as
 * computeExpiresAt in worker/lib/expiry.ts (used at creation); it lives in SQL here so a batch can
 * apply it to the rows it has just changed instead of to a snapshot read earlier.
 */
function expiryUpdate(db: D1Database, eventId: string, now: number): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE events SET
         expires_at = COALESCE(
           (SELECT unixepoch(MAX(date), '+1 day') * 1000 + ? FROM options WHERE event_id = events.id),
           created_at + ?
         ),
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(LIMITS.ttlAfterLastDateDays * DAY_MS, LIMITS.ttlWithoutDatesDays * DAY_MS, now, eventId);
}

export async function insertOption(db: D1Database, option: OptionRow): Promise<void> {
  await db.batch([optionInsert(db, option), expiryUpdate(db, option.event_id, option.created_at)]);
}

export async function deleteOption(db: D1Database, eventId: string, optionId: string, now: number): Promise<boolean> {
  const [removed] = await db.batch([
    db.prepare('DELETE FROM options WHERE id = ? AND event_id = ?').bind(optionId, eventId),
    expiryUpdate(db, eventId, now),
  ]);
  return (removed.meta.changes ?? 0) > 0;
}
```

Delete `refreshExpiry` and the `computeExpiresAt` import. In `worker/routes/options.ts` remove both
`refreshExpiry` calls and call `deleteOption(c.env.DB, event.id, c.req.param('optionId'), Date.now())`.

- [x] **Step 4: Run** `npm run test:worker` — all green, including the existing `date_exists` test (the
      UNIQUE violation now surfaces from `db.batch`).
- [x] **Step 5: Docs**: `docs/database.md` expiry section says the Worker recomputes the value in SQL in
      the same batch as the option change.
- [x] **Step 6: Commit** `fix(worker): compute expires_at in the option batch (review finding 1)`.

---

### Task 2: Poll actions scoped by id and ordered by request (findings 2, 3, state half of 6)

**Files:**

- Modify: `src/state/app.ts`, `src/state/pollActions.ts`, `src/lib/api.ts` (`getEvent` takes a signal)
- Modify: `src/state/app.test.ts`, `src/state/pollActions.test.ts`
- Modify callers: `src/components/VoteGrid.tsx`, `src/components/SuggestDate.tsx`,
  `src/components/AdminPanel.tsx`, `src/pages/EventPage.tsx`

**Interfaces (produced):**

```ts
// app.ts
export interface LoadError {
  message: string;
  /** The server said the poll no longer exists (404 or 410); a loaded event is dropped. */
  gone: boolean;
}
export interface PollSession {
  id: string;
  adminToken: string | null;
  me: ParticipantIdentity | null;
  event: EventView | null;
  error: LoadError | null;
}
export type AppAction =
  | { type: 'poll/open'; id: string; adminToken: string | null; me: ParticipantIdentity | null }
  | { type: 'poll/loaded'; id: string; event: EventView }
  | { type: 'poll/failed'; id: string; error: LoadError }
  | { type: 'poll/identity'; id: string; me: ParticipantIdentity | null }
  | { type: 'poll/close'; id: string };

// pollActions.ts
export interface PollActions {
  openPoll(id: string): Promise<void>;
  /** Re-fetch poll `id` if it is the one on screen; resolves to whether the fetch succeeded. */
  refresh(id: string): Promise<boolean>;
  /** Persist who this browser is in poll `id`; the session changes only while that poll is on screen. */
  setIdentity(id: string, me: ParticipantIdentity | null): void;
  /** Drop both tokens for poll `id`; closes the session if that poll is on screen. */
  forgetPoll(id: string): void;
}
// api.ts
getEvent: (id: string, adminToken: string | null, signal?: AbortSignal) => Promise<EventView>;
```

Reducer rules (each a test):

- `poll/failed` keeps `event` unless `error.gone`; `poll/loaded` clears `error`.
- `poll/identity` and `poll/close` are ignored when `id` is not the current session's.

Action rules (each a test):

- `load` numbers each fetch; a result (success or failure) whose number is below the last applied one is
  discarded, and the previous in-flight fetch is aborted when a new one starts. Aborted fetches dispatch
  nothing.
- `setIdentity(id, me)` writes storage under `id` always and dispatches only when `id` is current.
- `forgetPoll(id)` clears storage under `id` always and closes only when `id` is current.
- `refresh(id)` is a no-op returning `false` when `id` is not current.
- `openPoll(id)` falls back to the in-memory session's `adminToken`/`me` when storage has nothing for
  `id` and the open session is that poll (blocked storage; StrictMode double effect).
- `poll/failed` carries `gone: true` for `ApiRequestError` 404 and 410.

Tests to add in `pollActions.test.ts` (the harness already runs dispatched actions through the real reducer):

```ts
it('applies refreshes in request order even when the responses arrive reversed', async () => {
  const h = harness();
  h.getEvent.mockResolvedValueOnce(event({ participants: [] }));
  await h.actions.openPoll('ev1');
  let resolveOld!: (v: EventView) => void;
  let resolveNew!: (v: EventView) => void;
  h.getEvent.mockImplementationOnce(() => new Promise((r) => (resolveOld = r)));
  h.getEvent.mockImplementationOnce(() => new Promise((r) => (resolveNew = r)));
  const older = h.actions.refresh('ev1');
  h.actions.setIdentity('ev1', me); // the participant was created between the two requests
  const newer = h.actions.refresh('ev1');
  resolveNew(event()); // lists p1
  await newer;
  resolveOld(event({ participants: [] })); // predates p1
  await older;
  expect(h.state().poll?.me).toEqual(me);
  expect(h.storage.getParticipant('ev1')).toEqual(me);
  expect(h.state().poll?.event?.participants).toHaveLength(1);
});

it('stores a late identity under the poll it belongs to, not the one now on screen', async () => {
  const h = harness();
  h.getEvent.mockResolvedValue(event({ id: 'A', participants: [] }));
  await h.actions.openPoll('A');
  h.storage.setParticipant('B', meB);
  h.getEvent.mockResolvedValue(event({ id: 'B', participants: [{ id: 'pb', nickname: 'Bea', votes: {}, createdAt: 0 }] }));
  await h.actions.openPoll('B');
  h.actions.setIdentity('A', meA); // A's answer request completed after the navigation
  expect(h.storage.getParticipant('A')).toEqual(meA);
  expect(h.storage.getParticipant('B')).toEqual(meB);
  expect(h.state().poll?.me).toEqual(meB);
});

it('forgets a poll that is no longer on screen without closing the current one', …);
it('keeps a loaded event through a transient refresh failure and reports it', …);
it('drops the event when the refresh says the poll is gone', …);
it('keeps credentials from the open session when storage has nothing (blocked storage)', …);
```

- [x] Write the tests, run `npx vitest run --project unit src/state` to see them fail.
- [x] Implement `app.ts`, `pollActions.ts`, `api.ts` as specified.
- [x] Update callers: `refresh(id)`, `setIdentity(id, …)`, `forgetPoll(id)`; `EventPage` adapts to
      `error.message` (the banner itself is Task 5).
- [x] `npm run lint && npm run typecheck && npm run test:unit` green.
- [x] Commit `fix(client): order poll fetches and scope identity writes by poll id (findings 2, 3)`.

---

### Task 3: Organiser access when storage is blocked (finding 4)

**Files:**

- Modify: `src/pages/CreatePage.tsx` (navigate to `/e/:id#admin=TOKEN`)
- Modify: `src/lib/storage.ts` (`available()` probe), `src/lib/storage.test.ts`
- Modify: `src/components/ShareBox.tsx`, `src/components/EditPanel.tsx` (notice when not persisting)
- Test: `src/state/pollActions.test.ts` (already in Task 2: in-memory fallback), `e2e/poll.spec.ts`

Design:

- Creation hands the token to the poll page through the same fragment the admin link uses. `openPoll`
  moves it into storage (best effort) and strips the fragment with `replaceState`, so the history entry
  never keeps it. Storage is still written at creation so a reload works when storage does work.
- `storage.available()` probes once (`setItem`/`removeItem` of `pikadai:probe`), memoised. Components show
  a one-line notice when it is false: ShareBox under the admin link ("This browser is not saving site
  data, so it will not remember your organiser link. Keep the admin link somewhere safe."), EditPanel for
  a new answer ("…so you will not be able to change this answer later from this browser.").

e2e (`e2e/poll.spec.ts`, "organising a poll"):

```ts
test('the organiser keeps access when the browser blocks storage', async ({ page, request, clientIp }) => {
  await page.addInitScript(() => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    Object.defineProperty(window, 'localStorage', { get: blocked });
  });
  await page.goto('/');
  await page.getByLabel('What are you planning?').fill('No storage');
  await pickDate(page, futureIso(20));
  const create = page.getByRole('button', { name: 'Create poll' });
  await waitForTurnstile(create);
  await create.click();
  await expect(page).toHaveURL(/\/e\/[A-Za-z0-9_-]{22}$/, { timeout: 20_000 });
  await expect(page.getByText('organiser view')).toBeVisible();
  await expect(page.getByLabel('Admin link')).toHaveValue(/#admin=/);
  await expect(page.getByText(/not saving site data/)).toBeVisible();
});
```

- [x] Commit `fix(client): keep organiser access when storage is blocked (finding 4)`.

---

### Task 4: Drafts survive a removed date (finding 5)

**Files:**

- Modify: `src/state/voteEditor.ts` (+ `{ type: 'options'; optionIds: readonly string[] }`),
  `src/state/voteEditor.test.ts`, `src/hooks/useVoteEditor.ts` (`syncOptions`, stable via `useCallback`)
- Modify: `src/components/VoteGrid.tsx` (effect on `event.options`; `unknown_option` → refresh, keep editor)
- Modify: `src/lib/errors.ts` (`unknown_option` copy no longer asks for a reload)
- Test: `e2e/poll.spec.ts`

Reducer: drop `draftVotes` keys not in `optionIds`; return the same state object when nothing changes.

VoteGrid:

```ts
const optionIds = useMemo(() => event.options.map((o) => o.id), [event.options]);
useEffect(() => {
  syncOptions(optionIds);
}, [optionIds, syncOptions]);
```

and in `save()`, wrap the request so an `unknown_option` rejection refreshes the poll (which prunes the
draft through the effect) while the editor stays open with the server's message.

e2e: organiser opens Ada's row, changes the nickname, removes the date Ada voted yes on (accept the
`window.confirm`), saves; the row shows the new nickname and the vote for the remaining date; the
request had no removed option.

- [x] Commit `fix(client): reconcile the answer draft when a date is removed (finding 5)`.

---

### Task 5: A refresh failure keeps the poll on screen (finding 6, UI half)

**Files:**

- Modify: `src/pages/EventPage.tsx`, `src/styles/components.css`
- Test: `e2e/poll.spec.ts`

EventPage renders:

- Loading while no event and no error.
- "Poll unavailable" only when `event` is null: message, "Try again" button (calls `refresh(id)`; hidden
  when `error.gone`), "Create a new poll" link.
- When `event` exists and `error` is set: the poll as usual plus a `role="alert"` card above the table:
  "Could not refresh the poll. {message}" with a "Try again" button.

e2e: organiser opens "Edit details" and types a title (unsaved draft); adds a date through "Add a date";
`page.route` makes the next `GET /api/events/:id` fail with 503 once; the alert appears, the form still
holds the typed title, "Try again" clears the alert and shows the new column.

- [x] Commit `fix(client): keep the poll visible through a refresh failure, with retry (finding 6)`.

---

### Task 6: Turnstile verification timeout (Cloudflare recommendation)

**Files:** `worker/lib/turnstile.ts`, `worker/lib/http.ts` (`errors.unavailable` 503), the two routes,
`src/lib/errors.ts` (+ `verification_unavailable`), `src/lib/errors.test.ts`, `worker/test/*.test.ts`,
`docs/architecture.md` (error code list).

```ts
export type TurnstileOutcome = 'ok' | 'rejected' | 'unavailable';
export async function verifyTurnstile(secret, token, remoteIp, expected, timeoutMs = 5000): Promise<TurnstileOutcome>;
```

`fetch(SITEVERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(timeoutMs) })`; a non-2xx,
timeout or network failure is `unavailable` → 503 `verification_unavailable` ("The verification service
did not respond. Please try again."); `success:false` or a binding mismatch is `rejected` → 403
`captcha_failed` as before.

- [x] Commit `fix(worker): time out Turnstile verification and answer 503 when it is unavailable`.

---

### Task 7: CI runs the build, the browser suite and coverage (findings 7, 8)

**Files:**

- Modify: `.github/workflows/ci.yml`, `package.json` (scripts, `@vitest/coverage-istanbul`),
  `vitest.config.ts` (coverage; drop the compatibility-date override), `playwright.config.ts`
  (port from `PORT`, `preview` project), `e2e/fixtures.ts` (tag by `baseURL`)
- Create: `e2e/preview.spec.ts` (SPA fallback, security headers, Turnstile renders under the CSP)
- Modify: `README.md`, `docs/project-structure.md`

CI jobs:

1. `checks`: `npm ci`, `npm run lint`, `npm run format:check`, `npm run build`, `npm run test:coverage`
   (uploads `coverage/` as an artifact).
2. `browser`: `npm ci`, `cp .dev.vars.example .dev.vars`, `npm run db:migrate:local`,
   `npx playwright install --with-deps chromium`, `npm run test:e2e` (uploads `playwright-report/` on
   failure). The `preview` project builds with `VITE_TURNSTILE_SITE_KEY` set to the public test key and
   serves `vite preview` on 4173.

Coverage: provider `istanbul` (Workers need instrumentation), `include` the three source trees, exclude
tests, `src/main.tsx`, `src/router.tsx`, `src/vite-env.d.ts`; `reporter: ['text', 'html', 'lcov']`;
thresholds for `src/state/**`, `shared/**` and `worker/**` set from the first measurement.

- [x] Commit `ci: build, browser journeys, production preview checks and coverage (findings 7, 8)`.

---

### Task 8: Documentation and review bookkeeping

- `docs/code-review-2026-10-03.md`: tick each finding, add a short "Done:" line naming the commit's change.
- `docs/architecture.md`: actions take the poll id; refresh error handling; new error code.
- `docs/cloudflare.md`: rate limits are per-location and eventually consistent (abuse control, not quota);
  Turnstile timeout; test runtime uses the deployment compatibility date.
- `README.md`: CI now runs build, browser tests and coverage; coverage command.
- Commit `docs: record the 2026-10-03 review fixes`.

### Final verification (superpowers:verification-before-completion)

`npm run lint && npm run format:check && npm run build && npm run test:coverage && npm run test:e2e`
all green in the worktree, with output quoted in the summary.
