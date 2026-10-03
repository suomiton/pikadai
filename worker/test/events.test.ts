import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { CreateEventResponse, EventView, TicketResponse } from '@shared/types';
import { LIMITS } from '@shared/limits';
import { computeExpiresAt } from '../db/queries';
import {
  DUMMY_TOKEN,
  addParticipant,
  agedTicket,
  bearer,
  client,
  countRows,
  createPoll,
  draft,
  forbidOutboundFetch,
  getView,
  insertEventRow,
  siteverifyOk,
  stubSiteverify,
} from './helpers';

describe('POST /api/events', () => {
  it('creates a poll and returns an admin token', async () => {
    const c = client();
    stubSiteverify(siteverifyOk('create'));
    const dates = [draft().dates[1], draft().dates[0]]; // deliberately unsorted
    const res = await c.post<CreateEventResponse>('/api/events', {
      ...draft({ dates, description: 'Bring snacks' }),
      ticket: await agedTicket(c.ip),
      turnstileToken: DUMMY_TOKEN,
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(res.body.adminToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const view = await getView(c, res.body.id);
    expect(view.title).toBe('Test poll');
    expect(view.description).toBe('Bring snacks');
    expect(view.options.map((o) => o.date)).toEqual([...dates].sort());
    expect(view.participants).toEqual([]);
    expect(view.viewer.isAdmin).toBe(false);
    expect(view.expiresAt).toBe(computeExpiresAt(dates, view.createdAt));
  });

  it('hands the token and the client address to siteverify', async () => {
    const c = client();
    const fetchMock = stubSiteverify(siteverifyOk('create'));
    await c.post('/api/events', { ...draft(), ticket: await agedTicket(c.ip), turnstileToken: 'tok-123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(form.get('response')).toBe('tok-123');
    expect(form.get('remoteip')).toBe(c.ip);
    expect(form.get('secret')).toBe(env.TURNSTILE_SECRET_KEY);
  });

  it('rejects a ticket that is too young, without contacting Turnstile', async () => {
    const c = client();
    const { body: issued } = await c.post<TicketResponse>('/api/tickets', undefined);
    const fetchMock = forbidOutboundFetch();
    const res = await c.post('/api/events', { ...draft(), ticket: issued.ticket, turnstileToken: DUMMY_TOKEN });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'ticket_too_early' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a ticket issued to another client', async () => {
    const issuedTo = client();
    const spender = client();
    forbidOutboundFetch();
    const res = await spender.post('/api/events', {
      ...draft(),
      ticket: await agedTicket(issuedTo.ip),
      turnstileToken: DUMMY_TOKEN,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'ticket_invalid' });
  });

  it('rejects an expired ticket', async () => {
    const c = client();
    forbidOutboundFetch();
    const res = await c.post('/api/events', {
      ...draft(),
      ticket: await agedTicket(c.ip, LIMITS.ticketMaxAgeMs + 1000),
      turnstileToken: DUMMY_TOKEN,
    });
    expect(res.body).toMatchObject({ code: 'ticket_expired' });
  });

  it('refuses to spend a ticket twice', async () => {
    const c = client();
    stubSiteverify(siteverifyOk('create'));
    const ticket = await agedTicket(c.ip);
    const first = await c.post('/api/events', { ...draft(), ticket, turnstileToken: DUMMY_TOKEN });
    const second = await c.post('/api/events', { ...draft(), ticket, turnstileToken: DUMMY_TOKEN });
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'ticket_used' });
  });

  it.each([
    ['solved on another hostname', siteverifyOk('create', 'evil.example')],
    ['solved for the answer form', siteverifyOk('answer')],
    ['not successful', { success: false, 'error-codes': ['invalid-input-response'] }],
    ['missing hostname and action', { success: true }],
  ])('rejects a Turnstile token that was %s', async (_label, siteverify) => {
    const c = client();
    stubSiteverify(siteverify);
    const res = await c.post('/api/events', { ...draft(), ticket: await agedTicket(c.ip), turnstileToken: DUMMY_TOKEN });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'captcha_failed' });
  });

  it("accepts Cloudflare's testing-key response, which names example.com and no action", async () => {
    const c = client();
    stubSiteverify({ success: true, hostname: 'example.com', metadata: { result_with_testing_key: true } });
    const res = await c.post('/api/events', { ...draft(), ticket: await agedTicket(c.ip), turnstileToken: DUMMY_TOKEN });
    expect(res.status).toBe(201);
  });

  it('treats a siteverify outage as a failed verification', async () => {
    const c = client();
    forbidOutboundFetch(); // the stub throws, as a network failure would
    const res = await c.post('/api/events', { ...draft(), ticket: await agedTicket(c.ip), turnstileToken: DUMMY_TOKEN });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'captcha_failed' });
  });

  it('validates the body field by field', async () => {
    const c = client();
    forbidOutboundFetch();
    const res = await c.post('/api/events', { title: '', dates: ['2026-02-30'], ticket: 'x', turnstileToken: 'y' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation_failed' });
    const paths = (res.body as { details: { path: string }[] }).details.map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['title', 'dates.0']));
  });

  it('rejects a body that is not JSON', async () => {
    const c = client();
    const res = await c.call('POST', '/api/events', { raw: '{not json', headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'invalid_json' });
  });

  it('rejects bodies over the size limit before reading them', async () => {
    const c = client();
    const big = JSON.stringify({ ...draft({ description: 'x'.repeat(LIMITS.requestBodyMaxBytes) }), ticket: 'x', turnstileToken: 'y' });
    const res = await c.call('POST', '/api/events', { raw: big, headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ code: 'payload_too_large' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('GET /api/events/:id', () => {
  it('marks the viewer as admin only for the bearer admin token', async () => {
    const poll = await createPoll();
    const c = poll.client;
    expect((await getView(c, poll.id)).viewer.isAdmin).toBe(false);
    expect((await getView(c, poll.id, bearer(poll.adminToken))).viewer.isAdmin).toBe(true);
    expect((await getView(c, poll.id, bearer('wrong-token'))).viewer.isAdmin).toBe(false);
    expect((await getView(c, poll.id, { 'X-Admin-Token': poll.adminToken })).viewer.isAdmin).toBe(false);
  });

  it('never exposes token hashes', async () => {
    const poll = await createPoll();
    await addParticipant(poll.client, poll.id, 'Ada');
    const res = await poll.client.get(`/api/events/${poll.id}`, bearer(poll.adminToken));
    expect(JSON.stringify(res.body)).not.toMatch(/hash|token/i);
  });

  it('404s for unknown ids', async () => {
    const res = await client().get('/api/events/doesnotexist0000000000');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'not_found' });
  });

  it('410s for a poll past its expiry even before the purge runs', async () => {
    await insertEventRow({ id: 'expired-poll-0000000000', expires_at: Date.now() - 1000 });
    const res = await client().get('/api/events/expired-poll-0000000000');
    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ code: 'expired' });
  });
});

describe('PATCH /api/events/:id', () => {
  it('requires the admin token', async () => {
    const poll = await createPoll();
    const anon = await poll.client.patch(`/api/events/${poll.id}`, { title: 'Hijacked' });
    expect(anon.status).toBe(403);
    expect(anon.body).toMatchObject({ code: 'admin_required' });

    const ok = await poll.client.patch(`/api/events/${poll.id}`, { title: 'Renamed', allowSuggestions: false }, bearer(poll.adminToken));
    expect(ok.status).toBe(204);
    const view = await getView(poll.client, poll.id);
    expect(view.title).toBe('Renamed');
    expect(view.allowSuggestions).toBe(false);
    expect(view.description).toBe(''); // untouched
  });

  it('rejects an empty patch', async () => {
    const poll = await createPoll();
    const res = await poll.client.patch(`/api/events/${poll.id}`, {}, bearer(poll.adminToken));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation_failed' });
  });
});

describe('DELETE /api/events/:id', () => {
  it('removes the poll and everything attached to it', async () => {
    const poll = await createPoll();
    const option = poll.view.options[0];
    await addParticipant(poll.client, poll.id, 'Ada', { [option.id]: 'yes' });

    const anon = await poll.client.delete(`/api/events/${poll.id}`);
    expect(anon.status).toBe(403);

    const res = await poll.client.delete(`/api/events/${poll.id}`, bearer(poll.adminToken));
    expect(res.status).toBe(204);
    expect((await poll.client.get<EventView>(`/api/events/${poll.id}`)).status).toBe(404);
    expect(await countRows('events', poll.id)).toBe(0);
    expect(await countRows('options', poll.id)).toBe(0);
    expect(await countRows('participants', poll.id)).toBe(0);
    expect(await countRows('votes', poll.id)).toBe(0);
  });
});
