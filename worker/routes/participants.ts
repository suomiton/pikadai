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
  nicknameTaken,
  updateParticipantWithVotes,
} from '../db/queries';
import { isAdmin, loadEvent, participantFromToken } from '../lib/auth';
import { randomId, randomToken, sha256Hex } from '../lib/crypto';
import { errors, isUniqueViolation, parseBody, readJson } from '../lib/http';
import { clientIp, rateLimit } from '../lib/ratelimit';
import { turnstileExpectations, verifyTurnstile } from '../lib/turnstile';

/** Mounted at /api/events/:id/participants */
export const participants = new Hono<AppEnv>();

const nicknameTakenError = () =>
  errors.conflict('That nickname is already taken in this poll', 'nickname_taken');

/** Drop votes for options that don't belong to this event. */
async function sanitizeVotes(
  db: D1Database,
  eventId: string,
  votes: Record<string, Answer>,
): Promise<Record<string, Answer>> {
  const valid = new Set((await getOptions(db, eventId)).map((o) => o.id));
  const clean: Record<string, Answer> = {};
  for (const [optionId, answer] of Object.entries(votes)) {
    if (!valid.has(optionId)) throw errors.badRequest('Vote refers to an unknown date', 'unknown_option');
    clean[optionId] = answer;
  }
  return clean;
}

participants.post('/', rateLimit((env) => env.WRITE_LIMITER), async (c) => {
  const event = await loadEvent(c);
  const body = parseBody(createParticipantSchema, await readJson(c));

  // Database checks before Turnstile: a full poll or a taken nickname must not spend the token.
  if ((await countParticipants(c.env.DB, event.id)) >= LIMITS.participantsMax) {
    throw errors.conflict('This poll is full', 'event_full');
  }
  if (await nicknameTaken(c.env.DB, event.id, body.nickname, null)) throw nicknameTakenError();
  const votes = await sanitizeVotes(c.env.DB, event.id, body.votes);

  const human = await verifyTurnstile(
    c.env.TURNSTILE_SECRET_KEY,
    body.turnstileToken,
    clientIp(c),
    turnstileExpectations(c.req.url, 'answer'),
  );
  if (!human) throw errors.forbidden('Verification failed, please try again', 'captcha_failed');

  const now = Date.now();
  const id = randomId();
  const editToken = randomToken();

  try {
    await insertParticipantWithVotes(
      c.env.DB,
      {
        id,
        event_id: event.id,
        nickname: body.nickname,
        edit_token_hash: await sha256Hex(editToken),
        created_at: now,
        updated_at: now,
      },
      votes,
    );
  } catch (err) {
    // The unique index catches the race the pre-check above cannot.
    if (isUniqueViolation(err)) throw nicknameTakenError();
    throw err;
  }

  return c.json({ id, editToken } satisfies CreateParticipantResponse, 201);
});

participants.put('/:participantId', rateLimit((env) => env.WRITE_LIMITER), async (c) => {
  const event = await loadEvent(c);
  const participantId = c.req.param('participantId');

  let participant = await participantFromToken(c, event, participantId);
  if (!participant && (await isAdmin(c, event))) {
    participant = await getParticipant(c.env.DB, event.id, participantId);
  }
  if (!participant) throw errors.forbidden('You can only edit your own answers', 'not_owner');

  const body = parseBody(updateParticipantSchema, await readJson(c));
  const nickname = body.nickname ?? participant.nickname;
  if (nickname !== participant.nickname && (await nicknameTaken(c.env.DB, event.id, nickname, participant.id))) {
    throw nicknameTakenError();
  }

  const votes = await sanitizeVotes(c.env.DB, event.id, body.votes);
  try {
    await updateParticipantWithVotes(c.env.DB, participant, nickname, votes, Date.now());
  } catch (err) {
    if (isUniqueViolation(err)) throw nicknameTakenError();
    throw err;
  }
  return c.body(null, 204);
});

participants.delete('/:participantId', rateLimit((env) => env.WRITE_LIMITER), async (c) => {
  const event = await loadEvent(c);
  const participantId = c.req.param('participantId');

  const owner = await participantFromToken(c, event, participantId);
  if (!owner && !(await isAdmin(c, event))) {
    throw errors.forbidden('You can only remove your own answers', 'not_owner');
  }

  const removed = await deleteParticipant(c.env.DB, event.id, participantId);
  if (!removed) throw errors.notFound('Participant not found');
  return c.body(null, 204);
});
