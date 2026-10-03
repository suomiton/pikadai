import { Hono } from 'hono';
import { LIMITS } from '@shared/limits';
import { addOptionSchema } from '@shared/schemas';
import type { EventOption } from '@shared/types';
import type { AppEnv } from '../env';
import { countOptions, deleteOption, getParticipant, insertOption } from '../db/queries';
import { bearerToken, isAdmin, isParticipantOwner, loadEvent, PARTICIPANT_ID_HEADER, requireAdmin } from '../lib/auth';
import { randomId } from '../lib/crypto';
import { errors, isUniqueViolation, parseBody, readJson } from '../lib/http';
import { rateLimit } from '../lib/ratelimit';

/** Mounted at /api/events/:id/options */
export const options = new Hono<AppEnv>();

options.post(
  '/',
  rateLimit((env) => env.WRITE_LIMITER),
  async (c) => {
    const event = await loadEvent(c.env.DB, c.req.param('id'));
    const token = bearerToken(c.req.header('Authorization'));
    const admin = await isAdmin(token, event);
    if (!admin && event.allow_suggestions !== 1) {
      throw errors.forbidden('The organiser has turned off date suggestions', 'suggestions_disabled');
    }

    const body = parseBody(addOptionSchema, await readJson(c));

    if ((await countOptions(c.env.DB, event.id)) >= LIMITS.optionsMax) {
      throw errors.conflict(`This poll already has the maximum of ${LIMITS.optionsMax} dates`, 'too_many_options');
    }

    // Attribute the suggestion to the participant if they prove who they are; otherwise anonymous.
    const participantId = c.req.header(PARTICIPANT_ID_HEADER);
    const claimed = !admin && participantId ? await getParticipant(c.env.DB, event.id, participantId) : null;
    const suggester = claimed && (await isParticipantOwner(token, claimed)) ? claimed : null;

    const option = {
      id: randomId(),
      event_id: event.id,
      date: body.date,
      suggested_by: suggester?.id ?? null,
      created_at: Date.now(),
    };

    try {
      await insertOption(c.env.DB, option);
    } catch (err) {
      if (isUniqueViolation(err)) throw errors.conflict('That date is already in the poll', 'date_exists');
      throw err;
    }

    return c.json({ id: option.id, date: option.date, suggestedBy: option.suggested_by } satisfies EventOption, 201);
  },
);

options.delete(
  '/:optionId',
  rateLimit((env) => env.WRITE_LIMITER),
  async (c) => {
    const event = await loadEvent(c.env.DB, c.req.param('id'));
    await requireAdmin(bearerToken(c.req.header('Authorization')), event);
    const removed = await deleteOption(c.env.DB, event.id, c.req.param('optionId'), Date.now());
    if (!removed) throw errors.notFound('Date not found');
    return c.body(null, 204);
  },
);
