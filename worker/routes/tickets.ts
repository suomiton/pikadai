import { Hono } from 'hono';
import { LIMITS } from '@shared/limits';
import type { TicketResponse } from '@shared/types';
import type { AppEnv } from '../env';
import { clientIp, rateLimit, rateLimitKey } from '../lib/ratelimit';
import { issueTicket } from '../lib/tickets';

export const tickets = new Hono<AppEnv>();

tickets.post(
  '/',
  rateLimit((env) => env.WRITE_LIMITER),
  async (c) => {
    const ticket = await issueTicket(c.env.TICKET_SECRET, rateLimitKey(clientIp(c)));
    // The client paces its progress steps on minAgeMs, so the delay has one source of truth.
    return c.json({ ticket, minAgeMs: LIMITS.minCreateDelayMs } satisfies TicketResponse, 201);
  },
);
