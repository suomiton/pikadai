import { Hono } from 'hono';
import type { TicketResponse } from '@shared/types';
import type { AppEnv } from '../env';
import { rateLimit } from '../lib/ratelimit';
import { issueTicket } from '../lib/tickets';

export const tickets = new Hono<AppEnv>();

tickets.post('/', rateLimit((env) => env.WRITE_LIMITER), async (c) => {
  const ticket = await issueTicket(c.env.TICKET_SECRET);
  return c.json({ ticket } satisfies TicketResponse, 201);
});
