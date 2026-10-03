# Comments design

Date: 2026-10-03. Branch: `feat/comments` off `main`.

## Intent

Let the people in a poll leave short comments under the availability table, posted under the same
nickname they answer with. The request, in the organiser's words:

- the same nickname is used for answers and comments, so the nickname is asked **before** the dates;
- comments are their own tile below the availability table;
- each comment shows the nickname, the date and time, and the text;
- comments cannot be edited or deleted;
- one comment per 10 seconds per nickname;
- after posting, the comment field and Send button stay hidden until the page is reloaded;
- at most 512 characters, enforced, with a character counter beside the textarea;
- the textarea grows with its content so the whole comment is visible while typing.

The session ran autonomously, so the decisions below are stated as assumptions a reviewer can overturn.

## Assumptions

1. **A nickname is an identity, taken once.** Today a visitor types a nickname and taps cells in one
   row and saves both at once. Now the nickname is a step of its own: a "Your nickname" form at the top of
   the Availability card (above the table) with the Turnstile check and a **Join** button. Joining creates
   the participant with no answers yet and stores the edit token as before. The editor then opens on the
   new row so the next tap is on a date; the number of steps to answer is unchanged. The old
   "Add your availability" button and the editable "new" row go away. Comments and answers both need a
   participant identity, so the organiser comments by joining like anyone else; the admin token alone
   cannot post a comment.
2. **Comments belong to the participant row.** `comments.participant_id` cascades on delete: when a
   participant leaves or the organiser removes them, their comments go too. That is the only way a
   comment disappears, which keeps "comments cannot be deleted" true for ordinary use while leaving
   the organiser a way to clear a spammer. A rename shows on old comments, since the nickname is read
   from the participant row.
3. **The 10-second rule is enforced on the server per participant**, atomically: the insert is an
   `INSERT … SELECT … WHERE NOT EXISTS (a newer comment by this participant)`, so two simultaneous
   posts cannot both get in. The client also hides the form after one post until reload, as asked.
4. **A per-poll cap of 200 comments** bounds storage and the size of the poll view, like the caps on
   dates and participants. Not asked for, added for the same reason the other caps exist.
5. Chronological order, oldest first. Timestamps are shown in the viewer's locale with
   `dateStyle: 'medium', timeStyle: 'short'`.

## Data

Migration `0003_comments.sql`:

```sql
CREATE TABLE comments (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  body           TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_comments_event_created ON comments (event_id, created_at);
CREATE INDEX idx_comments_participant_created ON comments (participant_id, created_at);
```

`shared/limits.ts` gains `commentMax: 512`, `commentsMax: 200`, `commentIntervalMs: 10_000`.
`shared/schemas.ts` gains `createCommentSchema = { body: trimmed, 1–512 }`. `shared/types.ts` gains
`Comment { id, participantId, nickname, body, createdAt }` and `EventView.comments: Comment[]`.

## API

| Method | Path                       | Auth                                        | Purpose                        |
| ------ | -------------------------- | ------------------------------------------- | ------------------------------ |
| POST   | `/api/events/:id/comments` | participant edit token + `X-Participant-Id` | Post a comment → 201 `Comment` |

Checks, cheapest first: load event (404/410), participant token (`403 not_participant`), body
(`400 validation_failed`), cap (`409 too_many_comments`), then the atomic insert; zero rows inserted
means `429 comment_too_soon`. `WRITE_LIMITER` applies as on every write. `GET /api/events/:id`
includes `comments` (joined to participants for the nickname).

## Client

- `JoinForm` (new, in `src/components/`): nickname field, storage notice, Turnstile, Join. Presentational
  with local draft state; `VoteGrid` runs the request (shared busy/error), stores the identity, refreshes,
  opens the editor on the new row and moves focus to its first date cell.
- `VoteGrid`, `voteEditor`, `EditPanel`, `VoteEditRow`: the `new` editing kind, the Turnstile token and the
  Add button are removed. `EditPanel` keeps Save / Cancel / Remove.
- `Comments` (new): list of comments (nickname, `<time>`, body; "you" tag on the viewer's own), then
  the form when the viewer has an identity and has not posted since the page loaded; otherwise a hint
  ("Join with your nickname above to comment" / "Reload the page to write another comment").
  Textarea with `maxLength`, a `n / 512` counter linked by `aria-describedby`, and a layout effect that
  sets its height from `scrollHeight`.
- `EventPage` order: header, Availability, Comments, Share, Organiser.
- `src/lib/api.ts` `addComment`; `src/lib/errors.ts` copy for `not_participant`, `too_many_comments`,
  `comment_too_soon`; `src/lib/dates.ts` `formatDateTime`.

## Tests

- `shared/schemas.test.ts`: comment schema trims, requires text, caps at 512.
- `worker/test/comments.test.ts`: posting as a participant; admin token and strangers refused; stored
  and returned in the view with the nickname, in order; second post within 10 s refused and allowed once
  the first is older (backdated in D1); cap; validation; cascade when the participant is removed; rename
  reflected.
- `worker/lib/eventView.test.ts`: comments mapped. `src/lib/dates.test.ts`: `formatDateTime`.
- `src/state/voteEditor.test.ts`: updated for the removed `new` kind. `src/lib/errors.test.ts`: new codes.
- `e2e/poll.spec.ts`: answering goes through the nickname step; a comments journey (join, post, form
  hidden, visible again after reload, second person sees it); `e2e/dialog.spec.ts` mock views carry
  `comments: []`.

## Documentation

`docs/architecture.md` (components, trust table, a "Commenting" flow, abuse controls, API reference,
error codes, non-goals), `docs/database.md` (ERD, table, access patterns, retention),
`docs/project-structure.md` (new files), `README.md` layout line.

## Out of scope

Editing or deleting individual comments, comment notifications, mentions, and an organiser-only
moderation endpoint beyond removing the participant.
