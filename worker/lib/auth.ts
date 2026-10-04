import { getEventRow, type EventRow, type ParticipantRow } from '../db/queries';
import { safeEqual, sha256Hex } from './crypto';
import { errors } from './http';

export const PARTICIPANT_ID_HEADER = 'X-Participant-Id';

/**
 * Both capability tokens travel as `Authorization: Bearer <token>`. Cloudflare's
 * log pipeline redacts credential headers, which a custom `X-*` header would not
 * get. A request carries at most one token: the client sends its admin token when
 * it has one and its participant token otherwise, and each check below simply
 * compares the token with the hash it cares about.
 *
 * Nothing here knows about Hono: routes read the header and the rows and pass
 * them in, so every function is a plain async function a unit test can call.
 */
export function bearerToken(authorization: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '');
  if (!match || match[1].length > 128) return null;
  return match[1];
}

/** Load the event a route's `:id` names, or fail with 404 / 410. */
export async function loadEvent(db: D1Database, id: string | undefined, now = Date.now()): Promise<EventRow> {
  if (!id || id.length > 64) throw errors.notFound();
  const event = await getEventRow(db, id);
  if (!event) throw errors.notFound();
  if (event.expires_at <= now) throw errors.gone();
  return event;
}

export async function isAdmin(token: string | null, event: EventRow): Promise<boolean> {
  if (!token) return false;
  return safeEqual(await sha256Hex(token), event.admin_token_hash);
}

export async function requireAdmin(token: string | null, event: EventRow): Promise<void> {
  if (!(await isAdmin(token, event))) throw errors.forbidden('Admin link required', 'admin_required');
}

/** Whether the token is this participant's edit token. */
export async function isParticipantOwner(token: string | null, participant: ParticipantRow): Promise<boolean> {
  if (!token) return false;
  return safeEqual(await sha256Hex(token), participant.edit_token_hash);
}

/** A disabled participant's own token may read the poll but change nothing; the organiser still may. */
export function assertNotDisabled(participant: ParticipantRow): void {
  if (participant.is_disabled === 1) {
    throw errors.forbidden('The organiser has disabled you in this poll', 'participant_disabled');
  }
}

/**
 * The row among `participants` that the request's `X-Participant-Id` names and its token opens, or null.
 * The poll view uses it so a disabled participant still receives their own row.
 */
export async function provenParticipant(
  token: string | null,
  participantId: string | undefined,
  participants: readonly ParticipantRow[],
): Promise<ParticipantRow | null> {
  const claimed = participantId ? participants.find((p) => p.id === participantId) : undefined;
  return claimed && (await isParticipantOwner(token, claimed)) ? claimed : null;
}
