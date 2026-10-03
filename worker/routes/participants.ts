import { Hono } from 'hono';
import { LIMITS } from '@shared/limits';
import { createParticipantSchema, updateParticipantSchema } from '@shared/schemas';
import type { Answer, CreateParticipantResponse } from '@shared/types';
import type { AppEnv } from '../env';
import {
  countParticipants,
  deleteParticipant,
  getOptions,
  getParticipant,
  insertParticipantWithVotes,
  nameTaken,
  updateParticipantWithVotes,
  type EventRow,
  type ParticipantRow,
} from '../db/queries';
import { bearerToken, isAdmin, isParticipantOwner, loadEvent } from '../lib/auth';
import { randomId, randomToken, sha256Hex } from '../lib/crypto';
import { errors, isUniqueViolation, parseBody, readJson } from '../lib/http';
import { clientIp, rateLimit } from '../lib/ratelimit';
import { requireHuman, turnstileExpectations } from '../lib/turnstile';

/** Mounted at /api/events/:id/participants */
export const participants = new Hono<AppEnv>();

const nameTakenError = () => errors.conflict('That name is already taken in this poll', 'name_taken');

/** Reject a vote set that refers to a date outside this poll; the input comes back unchanged. */
async function assertVotesBelongToEvent(
  db: D1Database,
  eventId: string,
  votes: Record<string, Answer>,
): Promise<Record<string, Answer>> {
  const valid = new Set((await getOptions(db, eventId)).map((o) => o.id));
  const unknown = Object.keys(votes).find((optionId) => !valid.has(optionId));
  if (unknown !== undefined) throw errors.badRequest('Vote refers to an unknown date', 'unknown_option');
  return votes;
}

/** A participant may be changed by whoever holds its edit token, and by the organiser. */
async function ownerOrAdmin(
  token: string | null,
  event: EventRow,
  participant: ParticipantRow | null,
): Promise<boolean> {
  if (participant && (await isParticipantOwner(token, participant))) return true;
  return isAdmin(token, event);
}

participants.post(
  '/',
  rateLimit((env) => env.WRITE_LIMITER),
  async (c) => {
    const event = await loadEvent(c.env.DB, c.req.param('id'));
    const body = parseBody(createParticipantSchema, await readJson(c));
    // The organiser joins like anyone else; the admin token on the request marks their row.
    const organiser = await isAdmin(bearerToken(c.req.header('Authorization')), event);

    // Database checks before Turnstile: a full poll or a taken name must not spend the token.
    if ((await countParticipants(c.env.DB, event.id)) >= LIMITS.participantsMax) {
      throw errors.conflict('This poll is full', 'event_full');
    }
    if (await nameTaken(c.env.DB, event.id, body.name, null)) throw nameTakenError();
    const votes = await assertVotesBelongToEvent(c.env.DB, event.id, body.votes);

    await requireHuman(
      c.env.TURNSTILE_SECRET_KEY,
      body.turnstileToken,
      clientIp(c),
      turnstileExpectations(c.req.url, 'answer'),
    );

    const now = Date.now();
    const id = randomId();
    const editToken = randomToken();

    try {
      await insertParticipantWithVotes(
        c.env.DB,
        {
          id,
          event_id: event.id,
          name: body.name,
          edit_token_hash: await sha256Hex(editToken),
          is_organiser: organiser ? 1 : 0,
          created_at: now,
          updated_at: now,
        },
        votes,
      );
    } catch (err) {
      // The unique index catches the race the pre-check above cannot.
      if (isUniqueViolation(err)) throw nameTakenError();
      throw err;
    }

    return c.json({ id, editToken } satisfies CreateParticipantResponse, 201);
  },
);

participants.put(
  '/:participantId',
  rateLimit((env) => env.WRITE_LIMITER),
  async (c) => {
    const event = await loadEvent(c.env.DB, c.req.param('id'));
    const participantId = c.req.param('participantId');
    const token = bearerToken(c.req.header('Authorization'));

    const participant = await getParticipant(c.env.DB, event.id, participantId);
    if (!participant || !(await ownerOrAdmin(token, event, participant))) {
      throw errors.forbidden('You can only edit your own answers', 'not_owner');
    }

    const body = parseBody(updateParticipantSchema, await readJson(c));
    const name = body.name ?? participant.name;
    if (name !== participant.name && (await nameTaken(c.env.DB, event.id, name, participant.id))) {
      throw nameTakenError();
    }

    const votes = await assertVotesBelongToEvent(c.env.DB, event.id, body.votes);
    try {
      await updateParticipantWithVotes(c.env.DB, participant, name, votes, Date.now());
    } catch (err) {
      if (isUniqueViolation(err)) throw nameTakenError();
      throw err;
    }
    return c.body(null, 204);
  },
);

participants.delete(
  '/:participantId',
  rateLimit((env) => env.WRITE_LIMITER),
  async (c) => {
    const event = await loadEvent(c.env.DB, c.req.param('id'));
    const participantId = c.req.param('participantId');
    const token = bearerToken(c.req.header('Authorization'));

    // The organiser may remove a participant without the row in hand, so a vanished one still answers 404.
    const participant = await getParticipant(c.env.DB, event.id, participantId);
    if (!(await ownerOrAdmin(token, event, participant))) {
      throw errors.forbidden('You can only remove your own answers', 'not_owner');
    }

    const removed = await deleteParticipant(c.env.DB, event.id, participantId);
    if (!removed) throw errors.notFound('Participant not found');
    return c.body(null, 204);
  },
);
