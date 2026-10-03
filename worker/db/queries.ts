import { LIMITS } from '@shared/limits';
import type { Answer } from '@shared/types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EventRow {
  id: string;
  title: string;
  description: string;
  admin_token_hash: string;
  allow_suggestions: number;
  ticket_nonce: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

export interface OptionRow {
  id: string;
  event_id: string;
  date: string;
  suggested_by: string | null;
  created_at: number;
}

export interface ParticipantRow {
  id: string;
  event_id: string;
  name: string;
  edit_token_hash: string;
  /** 1 when the join request carried the admin token. */
  is_organiser: number;
  created_at: number;
  updated_at: number;
}

export interface VoteRow {
  participant_id: string;
  option_id: string;
  answer: Answer;
}

export interface CommentRow {
  id: string;
  event_id: string;
  participant_id: string;
  body: string;
  created_at: number;
}

/** A comment as the view reads it: joined to its participant for the current name and role. */
export interface CommentWithAuthor extends CommentRow {
  name: string;
  is_organiser: number;
}

export async function getEventRow(db: D1Database, id: string): Promise<EventRow | null> {
  return db.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<EventRow>();
}

export async function insertEventWithOptions(
  db: D1Database,
  event: Omit<EventRow, 'updated_at'>,
  options: Array<Pick<OptionRow, 'id' | 'date'>>,
): Promise<void> {
  const statements = [
    db
      .prepare(
        `INSERT INTO events (id, title, description, admin_token_hash, allow_suggestions, ticket_nonce, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        event.title,
        event.description,
        event.admin_token_hash,
        event.allow_suggestions,
        event.ticket_nonce,
        event.created_at,
        event.created_at,
        event.expires_at,
      ),
    ...options.map((o) =>
      optionInsert(db, {
        id: o.id,
        event_id: event.id,
        date: o.date,
        suggested_by: null,
        created_at: event.created_at,
      }),
    ),
  ];
  await db.batch(statements);
}

export async function updateEvent(
  db: D1Database,
  id: string,
  patch: { title?: string; description?: string; allow_suggestions?: number },
  now: number,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    values.push(patch.title);
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    values.push(patch.description);
  }
  if (patch.allow_suggestions !== undefined) {
    sets.push('allow_suggestions = ?');
    values.push(patch.allow_suggestions);
  }
  sets.push('updated_at = ?');
  values.push(now, id);
  await db
    .prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function deleteEvent(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
}

export async function getOptions(db: D1Database, eventId: string): Promise<OptionRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM options WHERE event_id = ? ORDER BY date ASC')
    .bind(eventId)
    .all<OptionRow>();
  return results;
}

export async function countOptions(db: D1Database, eventId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM options WHERE event_id = ?')
    .bind(eventId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** The one INSERT for an option row, shared by poll creation and later additions. */
function optionInsert(db: D1Database, option: OptionRow): D1PreparedStatement {
  return db
    .prepare('INSERT INTO options (id, event_id, date, suggested_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(option.id, option.event_id, option.date, option.suggested_by, option.created_at);
}

/**
 * Recompute expires_at from the option rows as this transaction sees them. Same rule as
 * `computeExpiresAt` in worker/lib/expiry.ts, which poll creation uses; it is repeated in SQL here so
 * a batch can apply it to the rows it has just changed. A value computed in JavaScript from an earlier
 * read could be written after a concurrent request's and pull the expiry back (review finding 1).
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

/** Add a date and move the expiry in one transaction. */
export async function insertOption(db: D1Database, option: OptionRow): Promise<void> {
  await db.batch([optionInsert(db, option), expiryUpdate(db, option.event_id, option.created_at)]);
}

/** Remove a date and move the expiry in one transaction; false when the option was not in this poll. */
export async function deleteOption(db: D1Database, eventId: string, optionId: string, now: number): Promise<boolean> {
  const [removed] = await db.batch([
    db.prepare('DELETE FROM options WHERE id = ? AND event_id = ?').bind(optionId, eventId),
    expiryUpdate(db, eventId, now),
  ]);
  return (removed.meta.changes ?? 0) > 0;
}

export async function getParticipants(db: D1Database, eventId: string): Promise<ParticipantRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM participants WHERE event_id = ? ORDER BY created_at ASC')
    .bind(eventId)
    .all<ParticipantRow>();
  return results;
}

export async function getParticipant(
  db: D1Database,
  eventId: string,
  participantId: string,
): Promise<ParticipantRow | null> {
  return db
    .prepare('SELECT * FROM participants WHERE id = ? AND event_id = ?')
    .bind(participantId, eventId)
    .first<ParticipantRow>();
}

export async function countParticipants(db: D1Database, eventId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM participants WHERE event_id = ?')
    .bind(eventId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function nameTaken(
  db: D1Database,
  eventId: string,
  name: string,
  excludeParticipantId: string | null,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS hit FROM participants
       WHERE event_id = ? AND name = ? COLLATE NOCASE AND (? IS NULL OR id != ?)
       LIMIT 1`,
    )
    .bind(eventId, name, excludeParticipantId, excludeParticipantId)
    .first<{ hit: number }>();
  return row !== null;
}

export async function insertParticipantWithVotes(
  db: D1Database,
  participant: ParticipantRow,
  votes: Record<string, Answer>,
): Promise<void> {
  const statements = [
    db
      .prepare(
        `INSERT INTO participants (id, event_id, name, edit_token_hash, is_organiser, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        participant.id,
        participant.event_id,
        participant.name,
        participant.edit_token_hash,
        participant.is_organiser,
        participant.created_at,
        participant.updated_at,
      ),
    ...voteStatements(db, participant.id, votes),
  ];
  await db.batch(statements);
}

/** What a save may change: the name, the whole vote set, or both. An absent field is left as it is. */
export interface ParticipantPatch {
  name?: string;
  votes?: Record<string, Answer>;
}

/** Apply a patch in one transaction; the vote set, when given, replaces the old one wholesale. */
export async function updateParticipant(
  db: D1Database,
  participant: ParticipantRow,
  patch: ParticipantPatch,
  now: number,
): Promise<void> {
  const statements = [
    db
      .prepare('UPDATE participants SET name = ?, updated_at = ? WHERE id = ?')
      .bind(patch.name ?? participant.name, now, participant.id),
  ];
  if (patch.votes !== undefined) {
    statements.push(
      db.prepare('DELETE FROM votes WHERE participant_id = ?').bind(participant.id),
      ...voteStatements(db, participant.id, patch.votes),
    );
  }
  await db.batch(statements);
}

function voteStatements(db: D1Database, participantId: string, votes: Record<string, Answer>) {
  return Object.entries(votes).map(([optionId, answer]) =>
    db
      .prepare('INSERT INTO votes (participant_id, option_id, answer) VALUES (?, ?, ?)')
      .bind(participantId, optionId, answer),
  );
}

export async function deleteParticipant(db: D1Database, eventId: string, participantId: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM participants WHERE id = ? AND event_id = ?')
    .bind(participantId, eventId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function getVotesForEvent(db: D1Database, eventId: string): Promise<VoteRow[]> {
  const { results } = await db
    .prepare(
      `SELECT v.participant_id, v.option_id, v.answer
       FROM votes v
       JOIN participants p ON p.id = v.participant_id
       WHERE p.event_id = ?`,
    )
    .bind(eventId)
    .all<VoteRow>();
  return results;
}

export async function getCommentsForEvent(db: D1Database, eventId: string): Promise<CommentWithAuthor[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.event_id, c.participant_id, c.body, c.created_at, p.name, p.is_organiser
       FROM comments c
       JOIN participants p ON p.id = c.participant_id
       WHERE c.event_id = ?
       ORDER BY c.created_at ASC, c.id ASC`,
    )
    .bind(eventId)
    .all<CommentWithAuthor>();
  return results;
}

export async function countComments(db: D1Database, eventId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM comments WHERE event_id = ?')
    .bind(eventId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Insert a comment unless the participant has one newer than `quietSince` or the poll already holds
 * `maxPerEvent` comments. Both checks sit in the insert statement itself, so simultaneous posts, by
 * one participant or by many, cannot slip past them together. False when refused; the caller asks
 * `countComments` to tell the two reasons apart.
 */
export async function insertComment(
  db: D1Database,
  comment: CommentRow,
  quietSince: number,
  maxPerEvent: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO comments (id, event_id, participant_id, body, created_at)
       SELECT ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM comments WHERE participant_id = ? AND created_at > ?)
         AND (SELECT COUNT(*) FROM comments WHERE event_id = ?) < ?`,
    )
    .bind(
      comment.id,
      comment.event_id,
      comment.participant_id,
      comment.body,
      comment.created_at,
      comment.participant_id,
      quietSince,
      comment.event_id,
      maxPerEvent,
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Everything under one event, read in parallel; `toEventView` in worker/lib/eventView.ts shapes it for the client. */
export interface EventRows {
  options: OptionRow[];
  participants: ParticipantRow[];
  votes: VoteRow[];
  comments: CommentWithAuthor[];
}

export async function fetchEventRows(db: D1Database, eventId: string): Promise<EventRows> {
  const [options, participants, votes, comments] = await Promise.all([
    getOptions(db, eventId),
    getParticipants(db, eventId),
    getVotesForEvent(db, eventId),
    getCommentsForEvent(db, eventId),
  ]);
  return { options, participants, votes, comments };
}

export async function deleteExpiredEvents(db: D1Database, now: number): Promise<number> {
  const result = await db.prepare('DELETE FROM events WHERE expires_at <= ?').bind(now).run();
  return result.meta.changes ?? 0;
}
