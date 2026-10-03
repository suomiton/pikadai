# Application code review

Reviewed on **2026-10-03**, covering coding practices, client state management, tests and coverage, and
Cloudflare usage. This is a follow-up to the [earlier review](review-findings.md), based on the local
working tree, including the UI changes present during the review.

The main risks are data loss and asynchronous state updates. The review found six functional issues
and two testing gaps. The first three findings should take priority because they can delete poll data
or lose capability tokens.

File and line references identify the code as it stood on the review date. Live Cloudflare
configuration was not verified. The review made no application source changes; temporary probes were
removed after verification.

## Findings summary

Severity: **high** means a risk of data or credential loss, **medium** means a functional defect or a
significant verification gap, and **low** means a testing or maintenance improvement.

| Done | Finding | Severity | Issue                                                      |
| ---- | ------- | -------- | ---------------------------------------------------------- |
| [x]  | 1       | High     | Expiry updates can cause premature deletion                |
| [x]  | 2       | High     | Older responses can erase participant credentials          |
| [x]  | 3       | High     | Mutation callbacks can modify the wrong poll session       |
| [x]  | 4       | Medium   | Blocked storage can lose organiser access immediately      |
| [x]  | 5       | Medium   | Removing a date can make an open answer draft unsaveable   |
| [x]  | 6       | Medium   | A refresh failure removes the poll UI and its drafts       |
| [x]  | 7       | Medium   | CI does not verify TypeScript, builds, or browser journeys |
| [x]  | 8       | Low      | Coverage is neither measured nor enforced                  |

## Functional findings

### 1 Expiry updates can cause premature deletion

**Severity:** High

**Where:** [worker/db/queries.ts:143](../worker/db/queries.ts#L143),
[worker/routes/options.ts:45](../worker/routes/options.ts#L45).

`refreshExpiry()` reads the current option dates, calculates an expiry in JavaScript, and later writes
that value. Adding or deleting the option is also a separate database operation. Concurrent requests
can therefore apply expiry calculations in a different order from the date changes. A database error
between the mutation and the expiry update can also leave the two inconsistent.

**Evidence:** A targeted probe against real local D1 held an older date snapshot, added a later date
and updated its expiry, then released the older calculation. The older expiry overwrote the newer
one. Running the purge at that expiry deleted the poll even though its later date still existed.

**Recommended fix:** Mutate the dates and calculate the expiry inside one transaction, using a SQL
aggregate or database trigger. The calculation must use the options inside that transaction; putting
a value calculated beforehand into a batch would retain the race. Cloudflare documents D1 batches as
[SQL transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/).

**Regression coverage:** Verify concurrent date changes and rollback when the expiry update fails.

**Done:** `insertOption` and `deleteOption` run the option change and an SQL recalculation of
`expires_at` in one D1 batch (`expiryUpdate` in `worker/db/queries.ts`); `refreshExpiry` is gone. Tests:
`worker/test/queries.test.ts`, plus a concurrent-add case in `worker/test/options.test.ts`.

### 2 Older responses can erase participant credentials

**Severity:** High

**Where:** [src/state/pollActions.ts:31](../src/state/pollActions.ts#L31),
[src/state/app.ts:49](../src/state/app.ts#L49).

Load results are checked against the current poll ID, but overlapping requests for that same poll
have no ordering guard. An older response can replace newer state. If that older response does not
list a recently saved participant, it also clears their identity from state and storage.

**Evidence:** A probe resolved a newer response containing the saved participant before an older
response without them. The final state showed the older event and both the in-memory and stored
participant identities were null.

**Recommended fix:** Track a request generation and session generation. Check both before applying
results or performing storage cleanup. Abort superseded requests where possible.

**Regression coverage:** Resolve two refreshes in reverse order, including a participant created
between them. Also cover leaving a poll and returning to it before an old request finishes.

**Done:** fetches are numbered in `src/state/pollActions.ts`; a result is applied only when nothing newer
has been applied, and starting a fetch aborts the previous one (`api.getEvent` takes an `AbortSignal`).
Tests: reversed responses with a participant created between them; leaving a poll and returning before
its first load finishes.

### 3 Mutation callbacks can modify the wrong poll session

**Severity:** High

**Where:** [src/state/pollActions.ts:68](../src/state/pollActions.ts#L68),
[src/components/VoteGrid.tsx:119](../src/components/VoteGrid.tsx#L119).

`setIdentity()` writes to whichever poll is currently open. If an answer request for poll A completes
after the user navigates to poll B, A's edit token is stored under B. This can overwrite B's identity
and leave A's token unsaved. `forgetPoll()` has the same targeting problem for deletion callbacks.

**Evidence:** A probe opened A, switched to B, and then applied A's mutation callback. A's identity was
stored under B, while A had no stored identity.

**Recommended fix:** Pass the originating poll ID explicitly to mutation actions. Persist returned
credentials under that ID, and update or close the visible session only when the originating session
is still current. Scope refresh calls in the same way.

**Regression coverage:** Complete answer creation, answer removal, and poll deletion after navigation
to another poll, checking both polls' stored credentials.

**Done:** `refresh`, `setIdentity` and `forgetPoll` take the poll id. Storage is written under that id
and the session changes only while that poll is on screen; the reducer also ignores identity and close
actions for another poll. Tests in `src/state/pollActions.test.ts` and `src/state/app.test.ts`.

### 4 Blocked storage can lose organiser access immediately

**Severity:** Medium

**Where:** [src/pages/CreatePage.tsx:95](../src/pages/CreatePage.tsx#L95),
[src/lib/storage.ts:22](../src/lib/storage.ts#L22),
[src/state/pollActions.ts:52](../src/state/pollActions.ts#L52).

Creation relies on storage to carry the returned admin token into the poll page, but storage writes
silently ignore failures. When storage is blocked, creation succeeds and navigation opens the poll
without its admin token. The organiser cannot access the admin link needed to recover control.

Admin fragment capture has a related failure: it clears the fragment after a failed storage write.
A repeated opening effect, as in development StrictMode, then has no stored or fragment token to read.

**Evidence:** With storage operations configured to throw, a probe opened an admin fragment
successfully once and lost the admin token on the second open.

**Recommended fix:** Keep credentials in memory when persistence fails. Capture admin fragments into
that session before clearing them, and tell the user when credentials could not be persisted.

**Regression coverage:** Verify creation and repeated admin-link opening with blocked storage,
asserting retained organiser access rather than only asserting that storage functions do not throw.

**Done:** creation navigates to `/e/:id#admin=TOKEN`, the admin link's own channel, so the organiser
view opens from the fragment when storage is blocked. The actions keep the credentials they handed over in
memory for the second run of the opening effect, and the unit test models React's deferred commit.
`StorageNotice` tells the viewer under the admin link and in a first answer. Browser test: creation with
`localStorage` throwing.

### 5 Removing a date can make an open answer draft unsaveable

**Severity:** Medium

**Where:** [src/components/VoteGrid.tsx:163](../src/components/VoteGrid.tsx#L163),
[src/state/voteEditor.ts:38](../src/state/voteEditor.ts#L38).

An organiser can remove a date while an answer draft is open. The poll refresh removes the date from
the displayed columns, but `draftVotes` retains its vote. Save submits that removed option and the
server rejects the request with `unknown_option`. Reloading, as the error message requests, loses the
remaining unsaved draft.

**Evidence:** A browser probe opened an existing answer, changed its nickname, removed one of its
voted dates, and tried to save. The request still included the removed option and received HTTP 400
with `unknown_option`.

**Recommended fix:** Reconcile drafts when the option set changes, preserving the nickname and votes
for remaining dates. Handle poll changes without requiring the user to discard their whole draft.

**Regression coverage:** Save an open draft after a date is removed, verifying preservation of the
remaining changes.

**Done:** the vote editor's `options` action drops draft votes for removed dates, dispatched from
`VoteGrid` whenever the option set changes; an `unknown_option` answer refreshes the poll and keeps the
editor open, and the message no longer asks for a reload. Browser test: remove a date under an open
answer, then save.

### 6 A refresh failure removes the poll UI and its drafts

**Severity:** Medium

**Where:** [src/pages/EventPage.tsx:32](../src/pages/EventPage.tsx#L32),
[src/state/pollActions.ts:38](../src/state/pollActions.ts#L38).

The page treats any load error as fatal, even when an event is already available. A temporary refresh
failure therefore replaces the loaded poll with the unavailable screen and unmounts editors, losing
their drafts. That screen offers no retry control. Meanwhile, `refresh()` catches the error and
resolves normally, so mutation callers cannot distinguish a successful refresh from a failed one.

**Evidence:** A probe loaded a poll successfully, then made refresh fail with a network error. The
event remained in the store, the error was set, and the refresh promise did not reject. The page's
render condition replaces the loaded UI in that state.

**Recommended fix:** Keep the loaded poll visible, display a refresh error, and provide retry. Expose
the refresh outcome to callers. Handle an initial load failure and a confirmed deletion or expiry
according to their distinct meanings.

**Regression coverage:** Fail refresh after a successful mutation while another editor has an unsaved
draft, then retry without losing that draft.

**Done:** the reducer keeps the event through a transient failure and drops it only for 404 and 410;
`EventPage` shows a retryable alert above the table and the unavailable screen offers a retry unless the
poll is gone. `refresh()` resolves to whether it succeeded. Browser test: failed refresh with an open
draft, then retry.

## Tests and coverage

### 7 CI does not verify TypeScript builds or browser journeys

**Severity:** Medium

**Where:** [.github/workflows/ci.yml:29](../.github/workflows/ci.yml#L29),
[playwright.config.ts:25](../playwright.config.ts#L25).

CI runs lint, formatting, and Vitest. Vitest transpilation does not replace TypeScript checking, and
the workflow does not build the application or run its browser journeys. Type errors, bundling
failures, and browser regressions can therefore pass the configured checks.

The browser suite also runs against the development server. The production CSP is emitted only at
build time, so those tests do not verify the delivered security headers or the widget under that CSP.

**Recommended fix:** Add `npm run build` and browser tests to CI, installing the required browser.
Include a production preview check for SPA routing, security headers, and Turnstile rendering.

**Done:** CI runs `npm run build` (type check and bundle) and `npm run test:coverage` in one job and the
browser suite in another. A third Playwright project, `e2e/preview.spec.ts`, runs against `vite preview`
with the production bundle: SPA fallback, the `_headers` security headers and the Turnstile widget under
the production CSP.

### 8 Coverage is neither measured nor enforced

**Severity:** Low

**Where:** [vitest.config.ts:15](../vitest.config.ts#L15),
[package.json](../package.json).

There is no coverage configuration or coverage provider. Passing test counts therefore provide no
statement or branch coverage percentage. The suite covers pure reducers and Worker routes well,
but the timing, persistence, and editing scenarios above are missing. The injected action tests use
synchronous reducer dispatch, so they also do not exercise the provider's actual React scheduling.

**Recommended fix:** Add the regression cases above and measure branch coverage for state and server
logic. Add mounted component or hook tests where React scheduling and draft lifetime affect behavior.
Configure explicit source inclusion so untested production files remain visible in coverage reports.

Workers require instrumented Istanbul coverage; native V8 coverage is unsupported. See
[Cloudflare's coverage guidance](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#coverage).

**Done:** Istanbul coverage (`npm run test:coverage`) over `src/`, `shared/` and `worker/` with explicit
inclusion, text, HTML and lcov reports, and per-area thresholds in `vitest.config.ts`. No React rendering
library was added, keeping the earlier client-state decision: the scheduling and draft-lifetime scenarios
run in the browser suite, and the actions test models React's deferred commit where it changes the
outcome.

## Coding practices to retain

Pure reducers, shared Zod schemas, parameterized SQL, and injected dependencies make the application
understandable and testable. The reducer and context approach fits its current size. Form drafts have
clear owners, and the API keeps authorization decisions on the server.

The existing selective static asset routing, API `no-store` headers, Turnstile hostname and action
validation, and batched participant writes are sensible Cloudflare practices. The expiry mutation
gap in finding 1 needs the same transaction discipline already used for participant writes.

## Further Cloudflare recommendations

- **Treat rate limits as approximate abuse controls.** Cloudflare's counters are local to each
  location and eventually consistent. They cannot enforce a global quota. Use a separate mechanism
  if a hard global budget is required. See the
  [rate limiting documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
- **Test the deployment runtime and delivered assets.** Worker tests override the deployment's
  `2026-09-01` compatibility date with `2026-08-22`. Add production preview checks using the deployment
  date and keep the test runtime aligned when its dependency supports that date.
- **Consider a maximum scheduling horizon.** The date schema checks calendar validity but places no
  maximum future date on creation or suggestions. Valid dates can extend retention thousands of years.
  Enforce any chosen horizon on the server and provide the same early validation in the client.
- **Bound the Turnstile verification request.** The outbound fetch in
  [worker/lib/turnstile.ts:57](../worker/lib/turnstile.ts#L57) has no application timeout. Add a timeout
  and a retryable failure response so verification cannot hold a submission indefinitely.

### Status of the recommendations

- Rate limits: `docs/cloudflare.md` now says they are per location and eventually consistent, flood
  protection rather than a quota.
- Test runtime: `@cloudflare/vitest-pool-workers` 0.22.0, the latest, bundles a `workerd` whose newest date
  is 2026-08-22, so the override in `vitest.config.ts` stays with a note to remove it; the browser suite's
  `preview` project runs the built Worker on the deployment date.
- Scheduling horizon: not implemented. It is a product rule that also needs a `maxDate` in the `Calendar`
  for early feedback; left as an open decision.
- Turnstile: the `siteverify` call times out after five seconds and an unreachable or failing service
  answers `503 verification_unavailable`, which the client shows as "try again".

## Fix validation

Run in the fix branch (`fix/code-review-2026-10-03`) on 2026-10-03, after all eight findings were
addressed:

| Check                                                     | Result                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| Unit and Worker tests, with coverage (`test:coverage`)    | 206 tests passed across 26 files; every threshold met              |
| Browser tests (`test:e2e`)                                | 47 passed: 22 desktop, 22 mobile, 3 against the production preview |
| ESLint, Prettier, TypeScript (`tsc -b`), production build | Passed                                                             |

## Validation results

The following checks passed during the review:

| Check                            | Result                                  |
| -------------------------------- | --------------------------------------- |
| Unit and Worker tests            | 183 tests passed across 25 files        |
| Desktop and mobile browser tests | 24 tests passed                         |
| ESLint                           | Passed                                  |
| Prettier                         | Passed                                  |
| TypeScript                       | Passed                                  |
| Production build                 | Passed                                  |
| Targeted probes                  | Confirmed the behaviors described above |

The first browser run encountered missing trace files during artifact cleanup. A rerun with an
isolated output directory passed, and the latest UI changes subsequently passed all 24 browser tests.
Those cleanup errors were not attributed to an application defect.

The results describe local validation, including workerd and a local D1 database. They do not verify
the live deployment, its Cloudflare bindings, or its configured production secrets. Coverage was not
measured, so no coverage percentage is claimed.
