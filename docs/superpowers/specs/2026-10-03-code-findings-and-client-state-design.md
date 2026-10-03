# Code findings C1–C10 and client state design

Date: 2026-10-03. Branch: `refactor/code-review-findings` off `main` (after PR #2).

## Intent

Close the ten "C" findings in `docs/review-findings.md` and, in the same pass, restructure the React
client's state so that:

- the root of the component tree owns the main state in a single `useReducer` store,
- that state reaches components through React context rather than props passed down the tree,
- components that juggled many `useState` calls use a reducer instead, with the reducer exported as a
  pure function and unit-tested,
- the existing unit, Worker and browser tests keep passing, and new pure code gets tests.

The session ran autonomously, so the decisions below are stated as assumptions a reviewer can
overturn rather than questions that were asked.

## Assumptions

1. **"Main state" means the poll session**: the loaded `EventView`, the viewer's credentials for it (admin
   token, participant identity), and its load status. That is what `EventPage` currently drills into four
   children through five props. Form drafts (create form, admin details form, the vote editor) are
   component-local UI state; they get local reducers, not slots in the root store.
2. **Prop drilling** means passing a value through a component that does not use it. A parent passing a
   prop to the direct child that uses it is fine and stays.
3. **Behaviour stays the same** for users and for the browser tests: same copy, same roles and labels,
   same focus management. Two small changes are deliberate and listed under "Behaviour changes".
4. **C10's remaining half is in scope**: ESLint (`typescript-eslint`, `react-hooks`, `jsx-a11y`) and Prettier
   are added and run in CI. Prettier's `printWidth` is 120, not the documented 100 soft limit, because 170
   existing lines exceed 100 and only 37 exceed 120; the convention in `docs/project-structure.md` is
   updated to say 120.
5. Work is committed in small steps on the feature branch; nothing is pushed and no PR is opened.

## Client state

### Root store (`src/state/app.ts`, pure)

```ts
interface PollSession {
  id: string;
  adminToken: string | null;   // only kept once the server confirms viewer.isAdmin
  me: ParticipantIdentity | null;
  event: EventView | null;     // null while loading or after a failed first load
  error: string | null;        // message from the last failed load
}
interface AppState { poll: PollSession | null }

type AppAction =
  | { type: 'poll/open'; id: string; adminToken: string | null; me: ParticipantIdentity | null }
  | { type: 'poll/loaded'; id: string; event: EventView }
  | { type: 'poll/failed'; id: string; error: string }
  | { type: 'poll/identity'; me: ParticipantIdentity | null }
  | { type: 'poll/close' };
```

Rules the reducer owns (each one is a test):

- `poll/open` replaces any previous session and clears `event` and `error`.
- `poll/loaded` and `poll/failed` for an `id` other than the current session are ignored (stale response
  after navigating to another poll).
- On `poll/loaded`, `me` is dropped when no participant with that id is in the fresh event
  (`hasParticipant(event, me)` is exported so the actions module can mirror the change to storage).
- On `poll/loaded`, `adminToken` is dropped when `event.viewer.isAdmin` is false, so `adminToken` in state
  is always the effective one and `effectiveAdminToken` disappears from `EventPage`.
- `poll/identity` sets `me`; `poll/close` sets `poll` to null.

### Actions with side effects (`src/state/pollActions.ts`)

`createPollActions(deps)` returns stable functions; `deps` are injected so the module is tested under
Node with fakes: `{ api: Pick<typeof api, 'getEvent'>, storage, dispatch, getState, location: { readHash,
clearHash } }`.

- `openPoll(id)`: take `admin=` from the hash (`parseAdminHash(hash)` is a pure helper), write it to storage
  and clear the hash, else read the stored token; read the stored participant identity; dispatch
  `poll/open`; fetch the event and dispatch `poll/loaded` or `poll/failed` (message via `describeError`).
  This is the C8 fix: it runs from a `useEffect` keyed on the route id, never in a state initialiser.
- `refresh()`: fetch with the current session's id and admin token; if the stored identity is no longer
  in the event, clear it from storage; dispatch `poll/loaded` or `poll/failed`.
- `setIdentity(me)`: write storage, dispatch `poll/identity`.
- `forgetPoll()`: clear both tokens from storage for the current id, dispatch `poll/close`. Used after
  the organiser deletes the poll.

Mutations (`api.addParticipant`, `api.updateEvent`, …) stay in the components that own the buttons; the
actions module owns only the session and its persistence.

### Provider and hooks (`src/state/AppStateProvider.tsx`)

`AppStateProvider` wraps `RouterProvider` in `src/main.tsx`. It holds `useReducer(appReducer)`, a ref to
the latest state for `getState`, and the memoised actions. Hooks:

- `useAppState()` → `AppState`
- `usePollActions()` → the actions object
- `usePoll()` → `{ id, event, me, adminToken, isAdmin }` with `event` non-null; throws when used outside a
  loaded poll, which is a programming error.
- `useAdminToken()` → `string`; throws when the viewer is not the organiser.

`EventPage` becomes: read `id`, `useEffect(() => openPoll(id), [id, openPoll])`, render loading /
unavailable / the four sections. `VoteGrid`, `SuggestDate`, `ShareBox` and `AdminPanel` take no props and
read what they need through `usePoll()`, `useAdminToken()` and `usePollActions()`.

### Local reducers (all in `src/state/`, pure, tested)

| File | Used by | State |
| --- | --- | --- |
| `createForm.ts` | `CreatePage` | `title, description, dates: ReadonlySet, allowSuggestions, turnstileToken, fieldErrors, progress` |
| `adminForm.ts` | `AdminPanel` | `open, title, description, allowSuggestions, fieldErrors` |
| `voteEditor.ts` | `useVoteEditor` → `VoteGrid` | `editing, nickname, draftVotes, turnstileToken, opener` |

`busy` and `error` leave every component and live in `useAsyncAction` (C2). `status` strings for live
regions stay a single `useState` where needed.

## C1. VoteGrid split

`src/components/VoteGrid.tsx` keeps: the section, the table skeleton, the tally footer, the add button,
the three mutations (`save`, `remove`, `removeOption`) and the return-focus effect. It composes:

- `OptionHeader` (`<th>` per date: weekday, day, year, suggested tag, admin remove button),
- `VoteRow` (a saved participant: name or "you" tag, glyph cells, Edit button),
- `VoteEditRow` (the row being edited, new or existing: nickname input and vote buttons),
- `VoteCells` (the `<td>` run shared by the two rows; owns the glyphs),
- `EditPanel` (hint, Turnstile for new answers, error, Save / Cancel / Remove).

`useVoteEditor()` in `src/hooks/useVoteEditor.ts` wraps `voteEditorReducer` and returns the state plus
bound transitions: `startNew`, `startEdit(p)`, `cancel`, `close`, `toggle(option)`, `setNickname`,
`setTurnstileToken`. `toggle` returns the new answer so the caller can announce it.

`GLYPH`, `LABEL` and the `Cell` type move to `src/lib/votes.ts` beside `cycle`.

## C2. Shared pieces

- `useAsyncAction()` in `src/hooks/useAsyncAction.ts`: `{ busy, error, setError, run }`. `run(fn)` sets
  busy, clears the error, awaits `fn`, stores `describeError(err)` on failure, and resolves to `true` on
  success or `false` on failure so callers can reset Turnstile or keep the editor open.
- `<FormError id? message />`: renders the `role="alert"` paragraph or nothing. Replaces the eight copies.
- `<StatusAnnouncer message />`: the visually hidden `role="status"` paragraph used in four places.
- `<TextField>`: label, `<input>` or `<textarea>` (`multiline`), error span, `aria-invalid` and
  `aria-describedby`, and a forwarded `ref` for the focus-first-invalid-field behaviour. Used by
  `CreatePage` and `AdminPanel`.

## C3–C9. Shared and Worker

- **C3** `shared/dates.ts`: `parseIsoParts(iso): [year, month, day]`, used by `shared/schemas.ts`,
  `src/lib/dates.ts` and the expiry module.
- **C4** `shared/types.ts`: `export type Answer = z.infer<typeof answerSchema>`.
- **C5** `worker/lib/expiry.ts` gets `computeExpiresAt` (its test moves with it). `buildEventView` splits
  into `fetchEventRows(db, eventId)` in `queries.ts` and a pure `toEventView(event, rows, isAdmin)` in
  `worker/lib/eventView.ts` with a unit test. The GET route composes the two.
- **C6** `sanitizeVotes` becomes `assertVotesBelongToEvent`: finds the first unknown option id, throws
  `unknown_option`, returns the input. The misleading comment goes; the docs already say "rejected".
- **C7** `worker/lib/auth.ts` loses its Hono import. `bearerToken(header)`, `isAdmin(token, event)`,
  `requireAdmin(token, event)`, `isParticipantOwner(token, participant)` and `loadEvent(db, id, now)` take
  plain values; routes read the header and the participant row. A unit test covers the token parser and
  both checks.
- **C8** solved by the state design above.
- **C9** `optionInsert(db, option)` builds the single `INSERT INTO options` statement for both
  `insertEventWithOptions` and `insertOption`.

## C10. Lint and format

- `eslint.config.js` (flat): `@eslint/js` recommended, `typescript-eslint` recommended,
  `eslint-plugin-react-hooks` recommended, `eslint-plugin-jsx-a11y` recommended, over `src/`, `shared/`,
  `worker/`, `e2e/` and the config files. Generated `worker-configuration.d.ts` and `dist/` are ignored.
- `.prettierrc`: `singleQuote`, `printWidth: 120`, `trailingComma: "all"`; `.prettierignore` for generated
  output.
- Scripts: `lint`, `format`, `format:check`. CI runs `npm run lint` and `npm run format:check` before
  `npm test`. `build` is left alone so a deploy is never blocked by a style rule.
- The whole tree is formatted once in its own commit so the refactor diffs stay readable.

## Behaviour changes

1. A stored admin token the server does not accept is no longer sent on later refreshes within the same
   page view (it is dropped from state on the first load). Storage is left as it was.
2. `GET /api/events/:id` is unchanged, but the view is now assembled by `toEventView`; the JSON is
   byte-for-byte the same shape.

## Testing

- New unit tests: `shared/dates.test.ts`, `worker/lib/expiry.test.ts` (moved), `worker/lib/eventView.test.ts`,
  `worker/lib/auth.test.ts`, `src/state/app.test.ts`, `src/state/pollActions.test.ts`,
  `src/state/createForm.test.ts`, `src/state/adminForm.test.ts`, `src/state/voteEditor.test.ts`.
- `vitest.config.ts` unit project includes `src/**/*.test.ts`.
- Existing Worker integration tests and the Playwright journeys run unchanged and must pass.
- No React rendering library is added; hooks and components are covered by the browser tests.

## Documentation

`docs/review-findings.md` ticks C1–C10 with done notes. `docs/project-structure.md` gains the new files,
the lint/format scripts and the 120-column rule. `docs/architecture.md` describes the root store and
context in the Frontend paragraph. `docs/database.md` points at `worker/lib/expiry.ts` and the
`fetchEventRows` / `toEventView` pair.
