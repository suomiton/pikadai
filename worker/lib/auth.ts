import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { getEventRow, getParticipant, type EventRow, type ParticipantRow } from '../db/queries';
import { safeEqual, sha256Hex } from './crypto';
import { errors } from './http';

export const PARTICIPANT_ID_HEADER = 'X-Participant-Id';

/**
 * Both capability tokens travel as `Authorization: Bearer <token>`. Cloudflare's
 * log pipeline redacts credential headers, which a custom `X-*` header would not
 * get. A request carries at most one token: the client sends its admin token when
 * it has one and its participant token otherwise, and each check below simply
 * compares the token with the hash it cares about.
 */
export function bearerToken(c: Context<AppEnv>): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header('Authorization') ?? '');
  if (!match || match[1].length > 128) return null;
  return match[1];
}

/** Load the event from the `:id` route param, or fail with 404 / 410. */
export async function loadEvent(c: Context<AppEnv>): Promise<EventRow> {
  const id = c.req.param('id');
  if (!id || id.length > 64) throw errors.notFound();
  const event = await getEventRow(c.env.DB, id);
  if (!event) throw errors.notFound();
  if (event.expires_at <= Date.now()) throw errors.gone();
  return event;
}

export async function isAdmin(c: Context<AppEnv>, event: EventRow): Promise<boolean> {
  const token = bearerToken(c);
  if (!token) return false;
  return safeEqual(await sha256Hex(token), event.admin_token_hash);
}

export async function requireAdmin(c: Context<AppEnv>, event: EventRow): Promise<void> {
  if (!(await isAdmin(c, event))) throw errors.forbidden('Admin link required', 'admin_required');
}

/** Returns the participant identified by the bearer token, if it is valid for this participant. */
export async function participantFromToken(
  c: Context<AppEnv>,
  event: EventRow,
  participantId: string,
): Promise<ParticipantRow | null> {
  const token = bearerToken(c);
  if (!token) return null;
  const participant = await getParticipant(c.env.DB, event.id, participantId);
  if (!participant) return null;
  return safeEqual(await sha256Hex(token), participant.edit_token_hash) ? participant : null;
}
