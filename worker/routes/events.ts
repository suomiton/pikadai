import { Hono } from 'hono';
import { LIMITS } from '@shared/limits';
import { createEventSchema, updateEventSchema } from '@shared/schemas';
import type { CreateEventResponse } from '@shared/types';
import type { AppEnv } from '../env';
import { deleteEvent, fetchEventRows, insertEventWithOptions, updateEvent } from '../db/queries';
import { bearerToken, isAdmin, loadEvent, PARTICIPANT_ID_HEADER, provenParticipant, requireAdmin } from '../lib/auth';
import { randomId, randomToken, sha256Hex } from '../lib/crypto';
import { toEventView } from '../lib/eventView';
import { computeExpiresAt } from '../lib/expiry';
import { errors, isUniqueViolation, parseBody, readJson } from '../lib/http';
import { clientIp, rateLimit, rateLimitKey } from '../lib/ratelimit';
import { verifyTicket } from '../lib/tickets';
import { requireHuman, turnstileExpectations } from '../lib/turnstile';

export const events = new Hono<AppEnv>();

events.post(
  '/',
  rateLimit((env) => env.CREATE_LIMITER),
  async (c) => {
    const body = parseBody(createEventSchema, await readJson(c));

    // Local checks before Turnstile: a rejected ticket must not cost the user a solved challenge.
    const ticket = await verifyTicket(c.env.TICKET_SECRET, body.ticket, {
      bind: rateLimitKey(clientIp(c)),
      minAgeMs: LIMITS.minCreateDelayMs,
      maxAgeMs: LIMITS.ticketMaxAgeMs,
    });
    if (!ticket.ok) throw errors.badRequest('Creation ticket rejected', `ticket_${ticket.reason}`);

    await requireHuman(
      c.env.TURNSTILE_SECRET_KEY,
      body.turnstileToken,
      clientIp(c),
      turnstileExpectations(c.req.url, 'create'),
    );

    const now = Date.now();
    const dates = [...new Set(body.dates)].sort();
    const id = randomId();
    const adminToken = randomToken();

    try {
      await insertEventWithOptions(
        c.env.DB,
        {
          id,
          title: body.title,
          description: body.description,
          admin_token_hash: await sha256Hex(adminToken),
          allow_suggestions: body.allowSuggestions ? 1 : 0,
          ticket_nonce: ticket.nonce,
          created_at: now,
          expires_at: computeExpiresAt(dates, now),
        },
        dates.map((date) => ({ id: randomId(), date })),
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw errors.conflict('Creation ticket already used', 'ticket_used');
      throw err;
    }

    return c.json({ id, adminToken } satisfies CreateEventResponse, 201);
  },
);

events.get(
  '/:id',
  rateLimit((env) => env.READ_LIMITER),
  async (c) => {
    const event = await loadEvent(c.env.DB, c.req.param('id'));
    const token = bearerToken(c.req.header('Authorization'));
    const admin = await isAdmin(token, event);
    const rows = await fetchEventRows(c.env.DB, event.id);
    // Only a participant's own token proves who they are; the organiser sees every row anyway.
    const me = admin ? null : await provenParticipant(token, c.req.header(PARTICIPANT_ID_HEADER), rows.participants);
    return c.json(toEventView(event, rows, { isAdmin: admin, participantId: me?.id ?? null }));
  },
);

events.patch(
  '/:id',
  rateLimit((env) => env.WRITE_LIMITER),
  async (c) => {
    const event = await loadEvent(c.env.DB, c.req.param('id'));
    await requireAdmin(bearerToken(c.req.header('Authorization')), event);
    const body = parseBody(updateEventSchema, await readJson(c));
    await updateEvent(
      c.env.DB,
      event.id,
      {
        title: body.title,
        description: body.description,
        allow_suggestions: body.allowSuggestions === undefined ? undefined : body.allowSuggestions ? 1 : 0,
      },
      Date.now(),
    );
    return c.body(null, 204);
  },
);

events.delete(
  '/:id',
  rateLimit((env) => env.WRITE_LIMITER),
  async (c) => {
    const event = await loadEvent(c.env.DB, c.req.param('id'));
    await requireAdmin(bearerToken(c.req.header('Authorization')), event);
    await deleteEvent(c.env.DB, event.id);
    return c.body(null, 204);
  },
);
