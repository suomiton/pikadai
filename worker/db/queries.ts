import type { Answer, EventOption, EventView, Participant } from '@shared/types';
import { computeExpiresAt } from '../lib/expiry';

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
  nickname: string;
  edit_token_hash: string;
  created_at: number;
  updated_at: number;
}

interface VoteRow {
  participant_id: string;
  option_id: string;
  answer: Answer;
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

export async function insertOption(db: D1Database, option: OptionRow): Promise<void> {
  await optionInsert(db, option).run();
}

export async function deleteOption(db: D1Database, eventId: string, optionId: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM options WHERE id = ? AND event_id = ?').bind(optionId, eventId).run();
  return (result.meta.changes ?? 0) > 0;
}

/** Recompute expires_at from the current set of option dates. */
export async function refreshExpiry(db: D1Database, event: EventRow, now: number): Promise<void> {
  const options = await getOptions(db, event.id);
  const expiresAt = computeExpiresAt(
    options.map((o) => o.date),
    event.created_at,
  );
  await db
    .prepare('UPDATE events SET expires_at = ?, updated_at = ? WHERE id = ?')
    .bind(expiresAt, now, event.id)
    .run();
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

export async function nicknameTaken(
  db: D1Database,
  eventId: string,
  nickname: string,
  excludeParticipantId: string | null,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS hit FROM participants
       WHERE event_id = ? AND nickname = ? COLLATE NOCASE AND (? IS NULL OR id != ?)
       LIMIT 1`,
    )
    .bind(eventId, nickname, excludeParticipantId, excludeParticipantId)
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
        `INSERT INTO participants (id, event_id, nickname, edit_token_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        participant.id,
        participant.event_id,
        participant.nickname,
        participant.edit_token_hash,
        participant.created_at,
        participant.updated_at,
      ),
    ...voteStatements(db, participant.id, votes),
  ];
  await db.batch(statements);
}

export async function updateParticipantWithVotes(
  db: D1Database,
  participant: ParticipantRow,
  nickname: string,
  votes: Record<string, Answer>,
  now: number,
): Promise<void> {
  const statements = [
    db.prepare('UPDATE participants SET nickname = ?, updated_at = ? WHERE id = ?').bind(nickname, now, participant.id),
    db.prepare('DELETE FROM votes WHERE participant_id = ?').bind(participant.id),
    ...voteStatements(db, participant.id, votes),
  ];
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

export async function buildEventView(db: D1Database, event: EventRow, isAdmin: boolean): Promise<EventView> {
  const [options, participants, votes] = await Promise.all([
    getOptions(db, event.id),
    getParticipants(db, event.id),
    getVotesForEvent(db, event.id),
  ]);

  const votesByParticipant = new Map<string, Record<string, Answer>>();
  for (const v of votes) {
    let bucket = votesByParticipant.get(v.participant_id);
    if (!bucket) {
      bucket = {};
      votesByParticipant.set(v.participant_id, bucket);
    }
    bucket[v.option_id] = v.answer;
  }

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    allowSuggestions: event.allow_suggestions === 1,
    createdAt: event.created_at,
    expiresAt: event.expires_at,
    options: options.map((o): EventOption => ({ id: o.id, date: o.date, suggestedBy: o.suggested_by })),
    participants: participants.map((p): Participant => ({
      id: p.id,
      nickname: p.nickname,
      votes: votesByParticipant.get(p.id) ?? {},
      createdAt: p.created_at,
    })),
    viewer: { isAdmin },
  };
}

export async function deleteExpiredEvents(db: D1Database, now: number): Promise<number> {
  const result = await db.prepare('DELETE FROM events WHERE expires_at <= ?').bind(now).run();
  return result.meta.changes ?? 0;
}
