# Code findings C1–C10 and client state: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close review findings C1–C10 and move the React client to a root reducer store delivered
through context, with every new pure module unit-tested.

**Architecture:** Pure reducers and a dependency-injected actions module in `src/state/` hold the poll
session; `AppStateProvider` at the root exposes them through hooks. Shared UI pieces (`useAsyncAction`,
`FormError`, `StatusAnnouncer`, `TextField`) remove the copy-pasted busy/error/form code. On the Worker,
pure helpers leave `queries.ts` and `auth.ts` loses its Hono coupling.

**Tech Stack:** React 19, react-router 8, Zod 4, Hono 4, Vitest 4 (`unit` project under Node, `worker`
project under workerd), Playwright, ESLint 9 flat config, Prettier 3.

**Spec:** `docs/superpowers/specs/2026-10-03-code-findings-and-client-state-design.md`

## Global Constraints

- Behaviour, copy, ARIA roles and labels, and focus management stay as they are; `e2e/poll.spec.ts` must
  pass unchanged.
- `shared/` compiles under both `tsconfig.app.json` and `tsconfig.worker.json`: no DOM, no Workers types.
- No SQL outside `worker/db/queries.ts`.
- Prettier: `singleQuote: true`, `printWidth: 120`, `trailingComma: "all"`.
- Commit after each task; do not push; no PR.
- Every step that says "run tests" means `npm run typecheck && npm test` unless a narrower command is given.

## Review Focus

1. Navigating from `/e/A` to `/e/B` while A's fetch is in flight must not show A's data under B's id
   (Task 7: stale `poll/loaded` ignored).
2. Visiting `/e/:id#admin=TOKEN` in dev StrictMode runs the open effect twice; the token must survive
   (Task 7: `openPoll` writes storage before dispatching, second run reads it back).
3. A participant removed by the organiser in another tab must lose the "you" row on the next refresh and
   the stale identity must leave storage (Task 7: `refresh` clears storage when `hasParticipant` is false).
4. A failed save in the vote editor keeps the editor open with the draft intact and resets Turnstile
   (Task 9: `run` resolves `false`, editor state untouched).
5. `toEventView` must produce `votes: {}` for a participant with no votes and `allowSuggestions: false`
   for `allow_suggestions = 0` (Task 4 tests).

---

### Task 1: Prettier and a one-off format

**Files:**

- Create: `.prettierrc`, `.prettierignore`
- Modify: `package.json` (scripts, devDependencies), `docs/project-structure.md` (Conventions: 120 columns)

- [ ] **Step 1:** `npm install --save-dev prettier`
- [ ] **Step 2:** Write `.prettierrc` `{ "singleQuote": true, "printWidth": 120, "trailingComma": "all" }` and
      `.prettierignore` with `dist`, `.wrangler`, `worker-configuration.d.ts`, `node_modules`, `test-results`,
      `playwright-report`, `package-lock.json`.
- [ ] **Step 3:** Add scripts `"format": "prettier --write ."` and `"format:check": "prettier --check ."`.
- [ ] **Step 4:** Run `npm run format`, then `npm run format:check` → `All matched files use Prettier code style!`
- [ ] **Step 5:** Run `npm run typecheck && npm test` → 132 tests pass.
- [ ] **Step 6:** Update the Formatting bullet in `docs/project-structure.md` Conventions to name Prettier
      and 120 columns; add `format` / `format:check` to the npm scripts table.
- [ ] **Step 7:** Commit `Add Prettier and format the tree`.

### Task 2: C3 `parseIsoParts` and C4 `Answer`

**Files:**

- Create: `shared/dates.ts`, `shared/dates.test.ts`
- Modify: `shared/schemas.ts:4-8`, `src/lib/dates.ts:13-16`, `shared/types.ts:1`

**Interfaces:**

- Produces: `export function parseIsoParts(iso: string): [year: number, month: number, day: number]`
  (month is 1–12, as written in the string).

- [ ] **Step 1:** Write `shared/dates.test.ts`:
  - `parseIsoParts('2026-10-03')` → `[2026, 10, 3]`
  - `parseIsoParts('2024-02-29')` → `[2024, 2, 29]`
- [ ] **Step 2:** Run `npx vitest run --project unit shared/dates.test.ts` → fails, module not found.
- [ ] **Step 3:** Implement `parseIsoParts` in `shared/dates.ts`; use it in `isValidCalendarDate`
      (`shared/schemas.ts`) and `parseIso` (`src/lib/dates.ts`, import from `@shared/dates`).
- [ ] **Step 4:** In `shared/types.ts` replace the literal union with
      `export type Answer = z.infer<typeof answerSchema>;` using `import type { z } from 'zod'` and
      `import type { answerSchema } from './schemas'`.
- [ ] **Step 5:** Run tests → all pass.
- [ ] **Step 6:** Commit `Share ISO date parsing and derive Answer from its schema (C3, C4)`.

### Task 3: C5 expiry module and C9 `optionInsert`

**Files:**

- Create: `worker/lib/expiry.ts`
- Move: `worker/db/queries.test.ts` → `worker/lib/expiry.test.ts`
- Modify: `worker/db/queries.ts` (remove `computeExpiresAt`, `DAY_MS`; add `optionInsert`),
  `worker/routes/events.ts:8`, `docs/database.md:154`

**Interfaces:**

- Produces: `export function computeExpiresAt(dates: readonly string[], createdAt: number): number` in
  `worker/lib/expiry.ts` (uses `parseIsoParts`).
- Produces: `function optionInsert(db: D1Database, option: Pick<OptionRow, 'id' | 'event_id' | 'date' | 'suggested_by' | 'created_at'>): D1PreparedStatement`
  (module-private in `queries.ts`).

- [ ] **Step 1:** `git mv worker/db/queries.test.ts worker/lib/expiry.test.ts`; change its import to `./expiry`.
- [ ] **Step 2:** Run `npx vitest run --project unit worker/lib/expiry.test.ts` → fails, module not found.
- [ ] **Step 3:** Create `worker/lib/expiry.ts`; delete the function and `DAY_MS` from `queries.ts`; import
      `computeExpiresAt` from `../lib/expiry` in `queries.ts` (`refreshExpiry`) and `routes/events.ts`.
- [ ] **Step 4:** Add `optionInsert` and use it in `insertEventWithOptions` (with `suggested_by: null`,
      `created_at: event.created_at`) and `insertOption`.
- [ ] **Step 5:** Run tests → all pass (Worker tests exercise both insert paths).
- [ ] **Step 6:** Update `docs/database.md` "computed in `computeExpiresAt` in `worker/db/queries.ts`" →
      `worker/lib/expiry.ts`; update the `queries.ts` line in the `docs/project-structure.md` tree.
- [ ] **Step 7:** Commit `Move expiry maths out of queries.ts and share the option insert (C5, C9)`.

### Task 4: C5 split `buildEventView`

**Files:**

- Create: `worker/lib/eventView.ts`, `worker/lib/eventView.test.ts`
- Modify: `worker/db/queries.ts:276-317`, `worker/routes/events.ts:69-73`, `docs/database.md:183`

**Interfaces:**

- Produces in `queries.ts`: `export interface EventRows { options: OptionRow[]; participants: ParticipantRow[]; votes: VoteRow[] }`
  (export `VoteRow`) and `export async function fetchEventRows(db: D1Database, eventId: string): Promise<EventRows>`.
- Produces in `eventView.ts`: `export function toEventView(event: EventRow, rows: EventRows, isAdmin: boolean): EventView`.

- [ ] **Step 1:** Write `worker/lib/eventView.test.ts` with fixture rows (one event, two options, two
      participants, votes only for the first):
  - maps columns: `allowSuggestions` is `false` for `allow_suggestions: 0`, `suggestedBy` copies `suggested_by`
  - groups votes by participant and gives the voteless participant `votes: {}`
  - sets `viewer.isAdmin` from the argument
- [ ] **Step 2:** Run it → fails, module not found.
- [ ] **Step 3:** Implement `toEventView`; replace `buildEventView` with `fetchEventRows`; GET route becomes
      `c.json(toEventView(event, await fetchEventRows(c.env.DB, event.id), admin))`.
- [ ] **Step 4:** Run tests → all pass.
- [ ] **Step 5:** Update the `buildEventView` row in `docs/database.md` Access patterns to
      `fetchEventRows` + `toEventView`.
- [ ] **Step 6:** Commit `Split buildEventView into fetchEventRows and a pure toEventView (C5)`.

### Task 5: C7 pure auth helpers and C6 `assertVotesBelongToEvent`

**Files:**

- Create: `worker/lib/auth.test.ts`
- Modify: `worker/lib/auth.ts`, `worker/routes/events.ts`, `worker/routes/options.ts`,
  `worker/routes/participants.ts:27-40`, `docs/project-structure.md:44`

**Interfaces:**

- Produces in `auth.ts` (no `hono` import):
  - `export function bearerToken(authorization: string | undefined): string | null`
  - `export async function loadEvent(db: D1Database, id: string | undefined, now = Date.now()): Promise<EventRow>`
  - `export async function isAdmin(token: string | null, event: EventRow): Promise<boolean>`
  - `export async function requireAdmin(token: string | null, event: EventRow): Promise<void>`
  - `export async function isParticipantOwner(token: string | null, participant: ParticipantRow): Promise<boolean>`
  - `PARTICIPANT_ID_HEADER` unchanged.

- [ ] **Step 1:** Write `worker/lib/auth.test.ts`:
  - `bearerToken('Bearer abc')` → `'abc'`; `bearerToken('bearer  abc ')` → `'abc'`; `bearerToken(undefined)`,
    `bearerToken('Basic abc')` and a 129-character token → `null`
  - `isAdmin(token, { admin_token_hash: await sha256Hex(token) })` → `true`; another token → `false`; `null` → `false`
  - `isParticipantOwner` mirrors the above against `edit_token_hash`
  - `requireAdmin` with a wrong token rejects with an `HttpError` whose `code` is `admin_required`
- [ ] **Step 2:** Run it → fails on the new signatures.
- [ ] **Step 3:** Rewrite `auth.ts`. In each route read `const token = bearerToken(c.req.header('Authorization'))`
      and call `loadEvent(c.env.DB, c.req.param('id'))`. In `participants.put` and `.delete` load the row with
      `getParticipant` first, then allow when `isParticipantOwner(token, row)` or `isAdmin(token, event)`. In
      `options.post` the suggester is the row when `isParticipantOwner` holds.
- [ ] **Step 4:** Rename `sanitizeVotes` to `assertVotesBelongToEvent`: find the first unknown id with
      `Object.keys(votes).find`, throw `unknown_option`, return `votes`. Comment: "Reject a vote set that refers
      to a date outside this poll."
- [ ] **Step 5:** Run tests → all pass, including `worker/test/participants.test.ts` and `options.test.ts`.
- [ ] **Step 6:** Update the `auth.ts` line in `docs/project-structure.md`.
- [ ] **Step 7:** Commit `Decouple auth helpers from Hono and rename sanitizeVotes (C6, C7)`.

### Task 6: `createForm` reducer, `TextField`, `FormError`, CreatePage

**Files:**

- Create: `src/state/createForm.ts`, `src/state/createForm.test.ts`, `src/components/TextField.tsx`,
  `src/components/FormError.tsx`
- Modify: `src/pages/CreatePage.tsx`, `src/components/TurnstileField.tsx:16-20`, `vitest.config.ts` (unit
  include `src/**/*.test.ts`)

**Interfaces:**

- `createForm.ts`:
  ```ts
  export type FieldKey = 'title' | 'description' | 'dates';
  export const FIELD_ORDER: readonly FieldKey[];
  export interface Progress {
    step: number;
    failed: boolean;
    message: string | null;
  }
  export interface CreateFormState {
    title: string;
    description: string;
    dates: ReadonlySet<string>;
    allowSuggestions: boolean;
    turnstileToken: string | null;
    fieldErrors: Record<string, string>;
    progress: Progress | null;
  }
  export type CreateFormAction =
    | { type: 'field'; key: 'title' | 'description'; value: string }
    | { type: 'allowSuggestions'; value: boolean }
    | { type: 'toggleDate'; iso: string }
    | { type: 'turnstile'; token: string | null }
    | { type: 'errors'; errors: Record<string, string> }
    | { type: 'progress'; step: number }
    | { type: 'progressFailed'; message: string }
    | { type: 'progressCleared' };
  export const initialCreateForm: CreateFormState;
  export function createFormReducer(state: CreateFormState, action: CreateFormAction): CreateFormState;
  export function firstInvalidField(errors: Record<string, string>): FieldKey | null;
  ```
- `TextField` props: `{ id: string; label: ReactNode; value: string; onChange: (value: string) => void; error?: string; multiline?: boolean; rows?: number; maxLength?: number; placeholder?: string; required?: boolean; ref?: Ref<HTMLInputElement | HTMLTextAreaElement> }`.
  Renders `<div className="field">`, `<label className="field-label" htmlFor={id}>`, the control with
  `className="input"`, `aria-invalid={error ? true : undefined}`, `aria-describedby={error ? `${id}-error` : undefined}`,
  and `<span id={`${id}-error`} className="field-error">` when `error` is set.
- `FormError` props: `{ message: string | null | undefined; id?: string }` → `<p id className="form-error" role="alert">` or `null`.

- [ ] **Step 1:** Write `src/state/createForm.test.ts`:
  - `toggleDate` adds then removes the same iso; other dates untouched
  - `progressFailed` keeps the current step, sets `failed: true` and the message; from `progress: null` uses step 0
  - `progress` sets the step with `failed: false, message: null`; `progressCleared` → `null`
  - `errors` replaces the whole map; `firstInvalidField({ dates: 'x', title: 'y' })` → `'title'`,
    `firstInvalidField({ form: 'x' })` → `null`
- [ ] **Step 2:** Widen the unit include to `src/**/*.test.ts`; run the new test → fails.
- [ ] **Step 3:** Implement `createForm.ts`.
- [ ] **Step 4:** Create `TextField.tsx` and `FormError.tsx`; rewrite `CreatePage.tsx` on `useReducer(createFormReducer, initialCreateForm)`,
      `TextField` for title and description, `FormError` for the form and dialog errors. Use `FormError` in
      `TurnstileField` for the missing-site-key message.
- [ ] **Step 5:** Run `npm run typecheck && npm test` → pass.
- [ ] **Step 6:** Commit `Drive the create form with a reducer; add TextField and FormError (C2)`.

### Task 7: Root store, actions, provider, EventPage

**Files:**

- Create: `src/state/app.ts`, `src/state/app.test.ts`, `src/state/pollActions.ts`,
  `src/state/pollActions.test.ts`, `src/state/AppStateProvider.tsx`
- Modify: `src/main.tsx`, `src/pages/EventPage.tsx`, `src/components/ShareBox.tsx`,
  `src/components/SuggestDate.tsx`, `src/components/AdminPanel.tsx`, `src/components/VoteGrid.tsx`
  (props → hooks only; the split is Task 9)

**Interfaces:**

- `app.ts`: `PollSession`, `AppState`, `AppAction` exactly as in the spec; `export const initialAppState: AppState = { poll: null }`;
  `export function appReducer(state: AppState, action: AppAction): AppState`;
  `export function hasParticipant(event: EventView, me: ParticipantIdentity | null): boolean`;
  `export function parseAdminHash(hash: string): string | null` (regex `/(?:^#|[#&])admin=([A-Za-z0-9_-]+)/`).
- `pollActions.ts`:
  ```ts
  export interface PollActionDeps {
    api: Pick<typeof api, 'getEvent'>;
    storage: typeof storage;
    dispatch: (action: AppAction) => void;
    getState: () => AppState;
    location: { readHash(): string; clearHash(): void };
  }
  export interface PollActions {
    openPoll(id: string): Promise<void>;
    refresh(): Promise<void>;
    setIdentity(me: ParticipantIdentity | null): void;
    forgetPoll(): void;
  }
  export function createPollActions(deps: PollActionDeps): PollActions;
  export const browserLocation: PollActionDeps['location']; // window.location.hash / history.replaceState
  ```
- `AppStateProvider.tsx`: `export function AppStateProvider({ children })`, `useAppState(): AppState`,
  `usePollActions(): PollActions`, `usePoll(): { id: string; event: EventView; me: ParticipantIdentity | null; adminToken: string | null; isAdmin: boolean }`,
  `useAdminToken(): string`.

- [ ] **Step 1:** Write `src/state/app.test.ts`:
  - `poll/open` replaces a previous session and clears `event` and `error`
  - `poll/loaded` with another id leaves state unchanged; with the current id sets `event` and clears `error`
  - `poll/loaded` drops `me` when the participant is absent and keeps it when present
  - `poll/loaded` drops `adminToken` when `viewer.isAdmin` is false
  - `poll/failed` with the current id sets `error`; `poll/identity` sets `me`; `poll/close` → `{ poll: null }`
  - `parseAdminHash('#admin=abc_-1')` → `'abc_-1'`; `parseAdminHash('#x=1&admin=t')` → `'t'`; `parseAdminHash('')` → `null`
- [ ] **Step 2:** Write `src/state/pollActions.test.ts` with fake `storage` (Map-backed), fake `api.getEvent`
      (`vi.fn`), a dispatch spy, and a `location` fake:
  - `openPoll` with hash `#admin=tok`: storage holds `tok`, `clearHash` called, dispatch sequence
    `poll/open` (adminToken `tok`) then `poll/loaded`
  - `openPoll` without hash reads the stored token and identity into `poll/open`
  - `openPoll` when `getEvent` rejects with `new ApiRequestError(404, 'not_found', 'x')` dispatches
    `poll/failed` with the message from `describeError`
  - `refresh` clears the stored participant when the event no longer lists `me`, and leaves it otherwise
  - `setIdentity(null)` removes the stored identity and dispatches `poll/identity`; `forgetPoll` clears both
    tokens and dispatches `poll/close`
- [ ] **Step 3:** Run both → fail, modules not found.
- [ ] **Step 4:** Implement `app.ts` and `pollActions.ts`. `openPoll` writes the hash token to storage
      before dispatching (Review Focus 2).
- [ ] **Step 5:** Run the two tests → pass.
- [ ] **Step 6:** Implement `AppStateProvider.tsx` (context value `useMemo(() => ({ state, actions }))`,
      `stateRef` kept current in render for `getState`), wrap `RouterProvider` in `main.tsx`, rewrite `EventPage`
      (`useEffect(() => { void openPoll(id); }, [id, openPoll])`; loading when `poll?.id !== id || (!poll.event && !poll.error)`;
      unavailable when `poll.error || !poll.event`). Switch the four children to `usePoll()`, `useAdminToken()`
      and `usePollActions()`; delete their `Props` interfaces. `AdminPanel.destroy` calls `forgetPoll()` then
      `navigate('/')`; `VoteGrid` uses `setIdentity` and `refresh`.
- [ ] **Step 7:** Run `npm run typecheck && npm test` → pass. Run `npm run test:e2e` → all pass.
- [ ] **Step 8:** Commit `Hold the poll session in a root reducer store delivered through context (C8)`.

### Task 8: `useAsyncAction`, `StatusAnnouncer`, `adminForm` reducer, SuggestDate

**Files:**

- Create: `src/hooks/useAsyncAction.ts`, `src/components/StatusAnnouncer.tsx`, `src/state/adminForm.ts`,
  `src/state/adminForm.test.ts`
- Modify: `src/components/AdminPanel.tsx`, `src/components/SuggestDate.tsx`, `src/components/CopyField.tsx`

**Interfaces:**

- `useAsyncAction(): { busy: boolean; error: string | null; setError(message: string | null): void; run(fn: () => Promise<void>): Promise<boolean> }`
- `StatusAnnouncer` props `{ message: string }` → `<p className="visually-hidden" role="status">{message}</p>`.
- `adminForm.ts`:

  ```ts
  export type AdminFieldKey = 'title' | 'description';
  export interface AdminFormState {
    open: boolean;
    title: string;
    description: string;
    allowSuggestions: boolean;
    fieldErrors: Partial<Record<AdminFieldKey, string>>;
  }
  export type AdminFormAction =
    | { type: 'open' }
    | { type: 'close' }
    | { type: 'sync'; event: Pick<EventView, 'title' | 'description' | 'allowSuggestions'> }
    | { type: 'field'; key: AdminFieldKey; value: string }
    | { type: 'allowSuggestions'; value: boolean }
    | { type: 'errors'; errors: Partial<Record<AdminFieldKey, string>> };
  export function adminFormFromEvent(
    event: Pick<EventView, 'title' | 'description' | 'allowSuggestions'>,
  ): AdminFormState;
  export function adminFormReducer(state: AdminFormState, action: AdminFormAction): AdminFormState;
  ```

- [ ] **Step 1:** Write `src/state/adminForm.test.ts`:
  - `sync` while `open` is false copies the event fields; while `open` is true it changes nothing
  - `close` clears `fieldErrors` and sets `open: false`; `field` updates one field
- [ ] **Step 2:** Run → fails.
- [ ] **Step 3:** Implement `adminForm.ts`, `useAsyncAction.ts`, `StatusAnnouncer.tsx`.
- [ ] **Step 4:** Rewrite `AdminPanel` on `useReducer(adminFormReducer, event, adminFormFromEvent)`, `useAsyncAction`,
      `TextField`, `FormError`, `StatusAnnouncer`; keep `pendingFocus` and the focus effect. Rewrite `SuggestDate`
      on `useAsyncAction`, `FormError`, `StatusAnnouncer`. Use `StatusAnnouncer` in `CopyField`.
- [ ] **Step 5:** Run `npm run typecheck && npm test` → pass.
- [ ] **Step 6:** Commit `Share busy/error handling and live-region markup (C2)`.

### Task 9: C1 vote editor reducer and VoteGrid split

**Files:**

- Create: `src/state/voteEditor.ts`, `src/state/voteEditor.test.ts`, `src/hooks/useVoteEditor.ts`,
  `src/components/OptionHeader.tsx`, `src/components/VoteRow.tsx`, `src/components/VoteEditRow.tsx`,
  `src/components/VoteCells.tsx`, `src/components/EditPanel.tsx`
- Modify: `src/lib/votes.ts` (add `Cell`, `GLYPH`, `LABEL`), `src/components/VoteGrid.tsx`

**Interfaces:**

- `voteEditor.ts`:
  ```ts
  export type Editing = { kind: 'new' } | { kind: 'existing'; participantId: string } | null;
  export type Opener = { kind: 'add' } | { kind: 'edit'; participantId: string } | null;
  export interface VoteEditorState {
    editing: Editing;
    opener: Opener;
    nickname: string;
    draftVotes: Record<string, Answer>;
    turnstileToken: string | null;
  }
  export type VoteEditorAction =
    | { type: 'startNew' }
    | { type: 'startEdit'; participant: Participant }
    | { type: 'close' }
    | { type: 'toggle'; optionId: string }
    | { type: 'nickname'; value: string }
    | { type: 'turnstile'; token: string | null };
  export const initialVoteEditor: VoteEditorState;
  export function voteEditorReducer(state: VoteEditorState, action: VoteEditorAction): VoteEditorState;
  ```
- `useVoteEditor(): { state: VoteEditorState; startNew(): void; startEdit(p: Participant): void; close(): void; toggle(option: EventOption): Answer | undefined; setNickname(v: string): void; setTurnstileToken(t: string | null): void }`
  (`toggle` computes `cycle(state.draftVotes[option.id])`, dispatches, returns the new answer).
- `votes.ts`: `export type Cell = Answer | 'none'; export const GLYPH: Record<Cell, string>; export const LABEL: Record<Cell, string>`.
- Components (props):
  - `OptionHeader { option: EventOption; isBest: boolean; canRemove: boolean; disabled: boolean; onRemove(option: EventOption): void }`
  - `VoteCells { options: readonly EventOption[]; votes: Record<string, Answer>; isBest(optionId: string): boolean; onToggle?: (option: EventOption) => void }`
    (interactive when `onToggle` is given)
  - `VoteRow { participant: Participant; options; isBest; isMine: boolean; canEdit: boolean; disabled: boolean; onEdit(p: Participant): void }`
    (keeps `data-edit-for` and the `aria-label` copy)
  - `VoteEditRow { options; isBest; votes; onToggle; nickname: string; onNicknameChange(v: string): void; nicknameInvalid: boolean; errorId: string; nicknameRef: Ref<HTMLInputElement>; isMine: boolean; autoFocus?: boolean; placeholder?: string }`
  - `EditPanel { isNew: boolean; busy: boolean; canSave: boolean; error: string | null; errorId: string; turnstileRef: Ref<TurnstileInstance>; onToken(t: string | null): void; onSave(): void; onCancel(): void; onRemove?: () => void }`

- [ ] **Step 1:** Write `src/state/voteEditor.test.ts`:
  - `startNew` sets `editing { kind: 'new' }`, `opener { kind: 'add' }`, empty nickname and votes
  - `startEdit(p)` copies `p.nickname` and `p.votes` (a copy, not the same object) and sets `opener { kind: 'edit', participantId }`
  - `toggle` walks yes → maybe → no → removed key; `close` resets `editing` and `turnstileToken` but keeps `opener`
- [ ] **Step 2:** Run → fails.
- [ ] **Step 3:** Implement `voteEditor.ts`, `useVoteEditor.ts`, and add `Cell`/`GLYPH`/`LABEL` to `votes.ts`.
- [ ] **Step 4:** Create the five components and rewrite `VoteGrid.tsx` to compose them, using
      `useVoteEditor`, `useAsyncAction`, `StatusAnnouncer`, `FormError`, `usePoll`, `usePollActions`. Keep
      `NICKNAME_REQUIRED`, the `focusRequest` effect and the three mutations in `VoteGrid`.
- [ ] **Step 5:** Run `npm run typecheck && npm test` → pass. Run `npm run test:e2e` → all pass.
- [ ] **Step 6:** Commit `Split VoteGrid into row, header and panel components behind useVoteEditor (C1)`.

### Task 10: ESLint, CI, docs

**Files:**

- Create: `eslint.config.js`
- Modify: `package.json`, `.github/workflows/ci.yml`, `docs/review-findings.md`, `docs/project-structure.md`,
  `docs/architecture.md` (Frontend paragraph), `tsconfig.node.json` (include `eslint.config.js` if it is
  type-checked; otherwise leave)

- [ ] **Step 1:** `npm install --save-dev eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-jsx-a11y globals`
- [ ] **Step 2:** Write `eslint.config.js`: ignores `dist`, `.wrangler`, `worker-configuration.d.ts`,
      `node_modules`, `test-results`, `playwright-report`; `js.configs.recommended`, `tseslint.configs.recommended`,
      `reactHooks.configs.flat.recommended` (or `['recommended-latest']` if that is the export) and
      `jsxA11y.flatConfigs.recommended` for `src/**/*.{ts,tsx}`; browser globals for `src/`, node globals for
      config files. Add script `"lint": "eslint ."`.
- [ ] **Step 3:** Run `npm run lint`; fix each report in code (prefer a fix over a disable; a disable needs a
      one-line reason).
- [ ] **Step 4:** In `ci.yml` add `- run: npm run lint` and `- run: npm run format:check` before `npm test`;
      rename the job to `Lint, format and tests`.
- [ ] **Step 5:** Docs: tick C1–C10 in `docs/review-findings.md` with "Done 2026-10-03" notes (C10: linter
      and formatter now run in CI); `docs/project-structure.md`: tree entries for `src/state/`, `src/hooks/`,
      the new components, `worker/lib/expiry.ts`, `eventView.ts`, `auth.test.ts`, `eslint.config.js`,
      `.prettierrc`; scripts table; conventions bullet for state ("Shared state lives in the root store…").
      `docs/architecture.md` Frontend paragraph: one sentence on the root reducer store and context.
- [ ] **Step 6:** Run `npm run lint && npm run format:check && npm run typecheck && npm test && npm run test:e2e` → all pass.
- [ ] **Step 7:** Commit `Add ESLint to CI and close the C findings (C10)`.
