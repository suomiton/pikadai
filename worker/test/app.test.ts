import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '@shared/limits';
import type { TicketResponse } from '@shared/types';
import worker from '../index';
import { client, countRows, insertEventRow } from './helpers';

describe('POST /api/tickets', () => {
  it('issues a signed ticket and tells the client how long to hold it', async () => {
    const res = await client().post<TicketResponse>('/api/tickets', undefined);
    expect(res.status).toBe(201);
    expect(res.body.ticket).toMatch(/^\d{13}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/);
    expect(res.body.minAgeMs).toBe(LIMITS.minCreateDelayMs);
  });
});

describe('API responses', () => {
  it('answer unknown routes with JSON and never allow caching', async () => {
    const res = await client().get('/api/nothing/here');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found', code: 'not_found' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('carry the same headers on error responses', async () => {
    const res = await client().post('/api/events', { title: 1 });
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('scheduled purge', () => {
  it('deletes expired polls and leaves the rest', async () => {
    await insertEventRow({ id: 'purge-expired-00000000', expires_at: Date.now() - 60_000 });
    await insertEventRow({ id: 'purge-alive-0000000000', expires_at: Date.now() + 60_000 });

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: '17 3 * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(await countRows('events', 'purge-expired-00000000')).toBe(0);
    expect(await countRows('events', 'purge-alive-0000000000')).toBe(1);
  });
});
