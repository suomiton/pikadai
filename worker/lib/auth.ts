import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { getEventRow, getParticipant, type EventRow, type ParticipantRow } from '../db/queries';
import { safeEqual, sha256Hex } from './crypto';
import { errors } from './http';

export const ADMIN_TOKEN_HEADER = 'X-Admin-Token';
export const PARTICIPANT_TOKEN_HEADER = 'X-Participant-Token';

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
  const token = c.req.header(ADMIN_TOKEN_HEADER);
  if (!token || token.length > 128) return false;
  return safeEqual(await sha256Hex(token), event.admin_token_hash);
}

export async function requireAdmin(c: Context<AppEnv>, event: EventRow): Promise<void> {
  if (!(await isAdmin(c, event))) throw errors.forbidden('Admin link required', 'admin_required');
}

/** Returns the participant identified by the participant token header, if valid for this event. */
export async function participantFromToken(
  c: Context<AppEnv>,
  event: EventRow,
  participantId: string,
): Promise<ParticipantRow | null> {
  const token = c.req.header(PARTICIPANT_TOKEN_HEADER);
  if (!token || token.length > 128) return null;
  const participant = await getParticipant(c.env.DB, event.id, participantId);
  if (!participant) return null;
  return safeEqual(await sha256Hex(token), participant.edit_token_hash) ? participant : null;
}
