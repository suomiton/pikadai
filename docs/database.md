# Database

Pikadai stores its data in Cloudflare D1, which is SQLite. This document describes the schema, the rules
the Worker enforces on top of it, how data expires, and how to work with migrations and the local copy.
Platform behaviour such as limits and backups is in [cloudflare.md](cloudflare.md#d1).

## Overview

Five tables. A poll is an `event`; it has date `options`; `participants` answer with `votes`, one per
option they responded to, and post `comments`.

```mermaid
erDiagram
    events ||--o{ options : "has"
    events ||--o{ participants : "has"
    participants ||--o{ votes : "casts"
    options ||--o{ votes : "receives"
    participants |o--o{ options : "suggested"
    events ||--o{ comments : "has"
    participants ||--o{ comments : "writes"

    events {
        text id PK
        text title
        text description
        text admin_token_hash
        int  allow_suggestions
        text ticket_nonce UK
        int  created_at
        int  updated_at
        int  expires_at
    }
    options {
        text id PK
        text event_id FK
        text date
        text suggested_by FK
        int  created_at
    }
    participants {
        text id PK
        text event_id FK
        text name
        text name_key
        text edit_token_hash
        int  is_organiser
        int  created_at
        int  updated_at
    }
    votes {
        text participant_id PK,FK
        text option_id PK,FK
        text answer
    }
    comments {
        text id PK
        text event_id FK
        text participant_id FK
        text body
        int  created_at
    }
```

Nothing in the database identifies a person. There are no IP addresses, user agents, emails, or
fingerprints. Names and comments are free text chosen by the participant.

## Conventions

| Convention     | Detail                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Identifiers    | `TEXT`, 22-character base64url from 16 random bytes. Never sequential, so nothing can be enumerated. |
| Timestamps     | `INTEGER` unix epoch milliseconds, UTC. Named `*_at`.                                                |
| Calendar dates | `TEXT` in `YYYY-MM-DD`. No time, no zone. Sorting and comparing as strings is correct.               |
| Booleans       | `INTEGER` 0 or 1 (SQLite has no boolean type).                                                       |
| Secrets        | Never stored. Only SHA-256 hex digests of tokens, in `*_token_hash` columns.                         |

## Tables

### `events`

One row per poll.

| Column              | Type                  | Notes                                                                             |
| ------------------- | --------------------- | --------------------------------------------------------------------------------- |
| `id`                | TEXT PK               | public poll id; the capability in the share link                                  |
| `title`             | TEXT                  | 1–100 characters, trimmed                                                         |
| `description`       | TEXT                  | 0–500 characters, trimmed; default `''`                                           |
| `admin_token_hash`  | TEXT                  | SHA-256 of the 43-character admin token                                           |
| `allow_suggestions` | INTEGER               | 1 if participants may add dates; default 1                                        |
| `ticket_nonce`      | TEXT UNIQUE, nullable | nonce from the creation ticket; the UNIQUE index is what makes tickets single-use |
| `created_at`        | INTEGER               |                                                                                   |
| `updated_at`        | INTEGER               | bumped by PATCH and by expiry recalculation                                       |
| `expires_at`        | INTEGER               | when the poll becomes unreadable and eligible for purge; see [Expiry](#expiry)    |

Index: `idx_events_expires_at (expires_at)` for the purge query.

### `options`

One row per candidate date in a poll.

| Column         | Type                                                   | Notes                                                                                                                                                     |
| -------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | TEXT PK                                                |                                                                                                                                                           |
| `event_id`     | TEXT FK → events, `ON DELETE CASCADE`                  |                                                                                                                                                           |
| `date`         | TEXT                                                   | `YYYY-MM-DD`; must be a real calendar date                                                                                                                |
| `suggested_by` | TEXT FK → participants, nullable, `ON DELETE SET NULL` | set when a participant proved identity while suggesting; null for creator-added dates. If that participant is later removed the date stays, unattributed. |
| `created_at`   | INTEGER                                                |                                                                                                                                                           |

Constraints: `UNIQUE (event_id, date)`, so a date appears at most once per poll. Index on `event_id`.

### `participants`

One row per answer in a poll.

| Column            | Type                                  | Notes                                                                                                |
| ----------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `id`              | TEXT PK                               | sent back to the browser together with the edit token                                                |
| `event_id`        | TEXT FK → events, `ON DELETE CASCADE` |                                                                                                      |
| `name`            | TEXT                                  | 1–32 characters, trimmed; shown as typed; `nickname` until migration 0005                            |
| `name_key`        | TEXT, nullable                        | the name as `nameKey` in `worker/lib/names.ts` folds it (migration 0006); unique per poll, see below |
| `edit_token_hash` | TEXT                                  | SHA-256 of the participant's edit token                                                              |
| `is_organiser`    | INTEGER                               | 1 when the join request carried the admin token (migration 0004); shown as an "organiser" pill       |
| `created_at`      | INTEGER                               |                                                                                                      |
| `updated_at`      | INTEGER                               |                                                                                                      |

Indexes: `idx_participants_event_id (event_id)` and two unique ones. Names are compared by their key: the
name normalised to NFKC, lowercased (so Ä and ä match, which SQLite's `NOCASE` and `lower()` cannot do),
stripped of invisible format characters and with every run of whitespace collapsed to one space
(`nameKey` in `worker/lib/names.ts`).

- `nameTaken` is the rule. It derives the key of every name in the poll and returns a friendly `name_taken`
  before any write. It does not read `name_key`, because rows that existed before migration 0006 got
  `lower(name)`, the closest key SQL can compute, and rows an older Worker inserted have none.
- `idx_participants_event_name_key (event_id, name_key)`, from 0006, closes the race where two requests
  pass the pre-check together; the Worker maps that UNIQUE violation to the same error.
- `idx_participants_event_name (event_id, name COLLATE NOCASE)`, from 0002 and renamed in 0005, stays as
  the backstop for rows without a key. Names equal ignoring ASCII case always share a key, so it never
  refuses a name the rule allows.

### `votes`

One row per participant per option they answered.

| Column           | Type                                        | Notes                                    |
| ---------------- | ------------------------------------------- | ---------------------------------------- |
| `participant_id` | TEXT FK → participants, `ON DELETE CASCADE` |                                          |
| `option_id`      | TEXT FK → options, `ON DELETE CASCADE`      |                                          |
| `answer`         | TEXT                                        | `CHECK (answer IN ('yes','no','maybe'))` |

Primary key `(participant_id, option_id)`. Index on `option_id`. A missing row means "no answer", which
the UI renders as `·`. Saving an answer deletes all of a participant's votes and inserts the new set in
one batch, so partial updates cannot occur.

### `comments`

One row per comment, from migration 0003.

| Column           | Type                                        | Notes                                                                             |
| ---------------- | ------------------------------------------- | --------------------------------------------------------------------------------- |
| `id`             | TEXT PK                                     |                                                                                   |
| `event_id`       | TEXT FK → events, `ON DELETE CASCADE`       |                                                                                   |
| `participant_id` | TEXT FK → participants, `ON DELETE CASCADE` | the author; the name is read from that row, so a rename shows on old comments too |
| `body`           | TEXT                                        | 1–512 characters, trimmed                                                         |
| `created_at`     | INTEGER                                     |                                                                                   |

Indexes: `idx_comments_event_created (event_id, created_at)` for the poll view, which lists comments
oldest first, and `idx_comments_participant_created (participant_id, created_at)` for the one-per-interval
check. Comments are never updated or deleted on their own; they go with their participant (leaving, or
removal by the organiser) or with the poll.

## Integrity rules

**Enforced by SQLite**

- Foreign keys with cascades, as listed above. D1 enables foreign-key enforcement by default.
- One date per poll; one name key per poll; one vote per participant per option; valid
  `answer` values; unique ticket nonce.

**Enforced by the Worker** (`worker/routes/*.ts`, `shared/schemas.ts`)

- Field lengths and trimming, real calendar dates, at most 40 options and 100 participants per poll. The
  two caps are checked before the insert, not inside the transaction, so simultaneous requests can overshoot
  by a few rows; accepted at this scale.
- Votes may only reference options belonging to the same event; others are rejected with `unknown_option`.
- A name pre-check for the friendly error; the unique index above is the guarantee.
- At most 200 comments per poll and one comment per 10 seconds per participant. Unlike the other caps,
  both are decided by the insert statement itself (`INSERT … SELECT … WHERE NOT EXISTS` a newer comment by
  that participant `AND` the poll's count is under the cap), so simultaneous posts cannot overshoot.
- Expired events (`expires_at <= now`) are treated as gone even before the purge deletes them.
- Writes that need to be all-or-nothing use `db.batch()`, which D1 runs as one transaction: event plus
  options on creation; participant plus votes on insert; name update plus vote replacement on edit.

## Expiry

`expires_at` follows one rule, written twice: `computeExpiresAt` in `worker/lib/expiry.ts` sets it when a
poll is created, and an SQL expression in `worker/db/queries.ts` (`expiryUpdate`) recomputes it whenever an
option is added or removed:

| Situation                  | `expires_at`                                     |
| -------------------------- | ------------------------------------------------ |
| Poll has at least one date | midnight UTC after the latest date, plus 30 days |
| Poll has no dates          | `created_at` plus 90 days                        |

The recalculation runs in the same D1 batch (a transaction) as the option insert or delete and reads the
option rows as that transaction sees them. Computing the value in the Worker from an earlier read and
writing it afterwards would let two concurrent date changes apply their expiries in the wrong order, so a
later date could end up with the earlier expiry and the purge could delete a live poll. Example: a poll
whose last date is 2026-11-21 expires at 2026-12-22T00:00:00Z. Adding 2026-11-28 moves that to 2026-12-29;
removing it moves it back.

The periods are `ttlAfterLastDateDays` and `ttlWithoutDatesDays` in `shared/limits.ts`. Changing them
affects polls created or edited afterwards; existing rows keep their stored value until an option change
triggers recalculation.

A cron trigger runs daily at 03:17 UTC and executes:

```sql
DELETE FROM events WHERE expires_at <= ?;
```

Cascades remove the poll's options, participants, votes, and comments. The handler logs the number of
events removed.

## Access patterns

All SQL lives in `worker/db/queries.ts`. The main ones:

| Function                         | Used by                       | Query shape                                                                                                                                  |
| -------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `getEventRow`                    | every `/api/events/:id` route | `SELECT * FROM events WHERE id = ?`                                                                                                          |
| `fetchEventRows` + `toEventView` | GET                           | four selects (options, participants, votes and comments joined to participants), then a pure mapping in `worker/lib/eventView.ts`            |
| `insertEventWithOptions`         | POST events                   | batch: 1 event insert + N option inserts                                                                                                     |
| `insertParticipantWithVotes`     | POST participants             | batch: 1 insert + N vote inserts                                                                                                             |
| `updateParticipant`              | PUT participant               | batch: name update, and when votes are sent, delete votes and insert the new set                                                             |
| `nameTaken`                      | POST/PUT participant          | `SELECT id, name … WHERE event_id = ?`, then `nameKey` compared in the Worker                                                                |
| `insertOption` / `deleteOption`  | options routes                | batch: insert or delete, plus the `expires_at` recalculation from the rows in the same transaction                                           |
| `insertComment`                  | POST comments                 | one `INSERT … SELECT … WHERE …` carrying the one-per-interval rule and the per-poll cap; `countComments` names a refusal's reason afterwards |
| `deleteExpiredEvents`            | cron                          | the purge above                                                                                                                              |

A poll view costs roughly 4 + participants + options + comments row reads, and creating a poll costs
1 + options row writes. See the D1 free-plan limits in [cloudflare.md](cloudflare.md#d1) for why this is comfortable.

## Sizing

Rough per-row footprint including indexes: an event about 400 bytes, an option about 120, a participant
about 200, a vote about 90, a comment about 150 plus its text. A typical poll with 6 dates and 10
participants who each answer every date is around 8 KB; a lively one with 50 short comments adds about
10 KB more. The 5 GB free-plan allowance therefore holds on the order of half a million such polls, and
the nightly purge keeps the live set bounded.

## Migrations

Migrations are plain SQL files in `migrations/`, applied in filename order by `wrangler d1 migrations
apply`. D1 tracks applied files in its own `d1_migrations` table.

**Create one**

```sh
npx wrangler d1 migrations create pikadai add_time_slots
# writes migrations/0002_add_time_slots.sql; edit it
```

**Apply**

```sh
npm run db:migrate:local      # local SQLite under .wrangler/state
npm run db:migrate:remote     # production, after review
```

**Rules of thumb**

- Keep migrations additive where possible: new tables, new nullable columns, new indexes. The previous
  Worker version then still works, which keeps `wrangler rollback` safe.
- SQLite's `ALTER TABLE` supports adding columns and renaming, but not dropping constraints or changing
  types. For those, create a new table, copy data, drop the old one, rename.
- Never edit a migration that has been applied remotely. Add a new one.
- Migration 0005 is the one exception to "additive" so far: it renames `participants.nickname` to `name`.
  The Worker before it would fail against the renamed table, so that migration and the Worker using it
  go out together, and a rollback of the Worker alone would need the column renamed back.
- Migration 0006 is additive, but the Worker that writes `name_key` needs the column: apply it before
  deploying that Worker.
- Local and remote migration state are independent. After pulling a branch with new migrations, run the
  local apply again.
- There is no "down" migration. For an emergency revert of production data use D1 Time Travel.

## Working with the local database

The local database is a SQLite file under `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/`, shared by
`npm run dev` and `wrangler d1 … --local`. It is gitignored.

```sh
# Query it
npx wrangler d1 execute pikadai --local --command "SELECT id, title, datetime(expires_at/1000,'unixepoch') FROM events"

# Reset it: stop the dev server first
rm -rf .wrangler/state/v3/d1
npm run db:migrate:local

# Browse bindings and run queries while `npm run dev` is up
curl http://localhost:5173/cdn-cgi/local/explorer/api/d1/database
```

Any SQLite client can open the `.sqlite` file directly for read-only inspection.

## Privacy and retention summary

- Stored: poll text, chosen dates, names, votes, comments, hashed tokens, timestamps.
- Not stored: IP addresses, user agents, emails, device identifiers, Turnstile tokens, creation tickets
  (only their nonce, which is random).
- Retention: until 30 days after the last date, or 90 days without dates, or earlier if the organiser
  deletes the poll. D1 Time Travel keeps 30 days of history after that for disaster recovery.

## Future changes

Time slots would add nullable `start_time` and `end_time` columns to `options` and extend the
`UNIQUE (event_id, date)` constraint to include them, which under SQLite means recreating the table in a
migration. Everything else, including votes and expiry, already works per option and would not change.
