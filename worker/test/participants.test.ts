import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '@shared/limits';
import type { CreateParticipantResponse } from '@shared/types';
import {
  DUMMY_TOKEN,
  addParticipant,
  asParticipant,
  bearer,
  client,
  createPoll,
  forbidOutboundFetch,
  getView,
  siteverifyOk,
  stubSiteverify,
} from './helpers';

describe('POST /api/events/:id/participants', () => {
  it('adds an answer with its votes and returns an edit token', async () => {
    const poll = await createPoll();
    const [a, b] = poll.view.options;
    const res = await addParticipant(poll.client, poll.id, '  Ada ', { [a.id]: 'yes', [b.id]: 'maybe' });
    expect(res.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(res.editToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const view = await getView(poll.client, poll.id);
    expect(view.participants).toHaveLength(1);
    expect(view.participants[0]).toMatchObject({
      id: res.id,
      nickname: 'Ada',
      votes: { [a.id]: 'yes', [b.id]: 'maybe' },
    });
  });

  it('requires a token solved for the answer action on this hostname', async () => {
    const poll = await createPoll();
    stubSiteverify(siteverifyOk('create'));
    const wrongAction = await poll.client.post(`/api/events/${poll.id}/participants`, {
      nickname: 'Ada',
      votes: {},
      turnstileToken: DUMMY_TOKEN,
    });
    expect(wrongAction.status).toBe(403);
    expect(wrongAction.body).toMatchObject({ code: 'captcha_failed' });
    stubSiteverify(siteverifyOk('answer', 'other.example'));
    const wrongHost = await poll.client.post(`/api/events/${poll.id}/participants`, {
      nickname: 'Ada',
      votes: {},
      turnstileToken: DUMMY_TOKEN,
    });
    expect(wrongHost.status).toBe(403);
  });

  it('rejects votes for dates outside the poll before contacting Turnstile', async () => {
    const poll = await createPoll();
    const fetchMock = forbidOutboundFetch();
    const res = await poll.client.post(`/api/events/${poll.id}/participants`, {
      nickname: 'Ada',
      votes: { 'not-an-option-id': 'yes' },
      turnstileToken: DUMMY_TOKEN,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'unknown_option' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a nickname already in use, ignoring case, before contacting Turnstile', async () => {
    const poll = await createPoll();
    await addParticipant(poll.client, poll.id, 'Ada');
    const fetchMock = forbidOutboundFetch();
    const res = await poll.client.post(`/api/events/${poll.id}/participants`, {
      nickname: 'ADA',
      votes: {},
      turnstileToken: DUMMY_TOKEN,
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'nickname_taken' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets exactly one of several simultaneous answers with the same nickname in', async () => {
    const poll = await createPoll();
    stubSiteverify(siteverifyOk('answer'));
    const attempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        poll.client.post(`/api/events/${poll.id}/participants`, {
          nickname: 'Racer',
          votes: {},
          turnstileToken: DUMMY_TOKEN,
        }),
      ),
    );
    const statuses = attempts.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect((await getView(poll.client, poll.id)).participants.filter((p) => p.nickname === 'Racer')).toHaveLength(1);
  });

  it('refuses a full poll before contacting Turnstile', async () => {
    const poll = await createPoll();
    const now = Date.now();
    await env.DB.batch(
      Array.from({ length: LIMITS.participantsMax }, (_, i) =>
        env.DB.prepare(
          'INSERT INTO participants (id, event_id, nickname, edit_token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(`filler-${poll.id.slice(0, 8)}-${i}`, poll.id, `Filler ${i}`, 'nohash', now, now),
      ),
    );
    const fetchMock = forbidOutboundFetch();
    const res = await poll.client.post(`/api/events/${poll.id}/participants`, {
      nickname: 'Late',
      votes: {},
      turnstileToken: DUMMY_TOKEN,
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'event_full' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates nickname and vote values', async () => {
    const poll = await createPoll();
    forbidOutboundFetch();
    const res = await poll.client.post(`/api/events/${poll.id}/participants`, {
      nickname: 'x'.repeat(LIMITS.nicknameMax + 1),
      votes: { [poll.view.options[0].id]: 'perhaps' },
      turnstileToken: DUMMY_TOKEN,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation_failed' });
  });
});

describe('PUT /api/events/:id/participants/:participantId', () => {
  it('lets the owner replace nickname and votes as a whole', async () => {
    const poll = await createPoll();
    const [a, b] = poll.view.options;
    const me = await addParticipant(poll.client, poll.id, 'Ada', { [a.id]: 'yes', [b.id]: 'yes' });
    const res = await poll.client.put(
      `/api/events/${poll.id}/participants/${me.id}`,
      { nickname: 'Ada L.', votes: { [b.id]: 'no' } },
      asParticipant(me),
    );
    expect(res.status).toBe(204);
    const [row] = (await getView(poll.client, poll.id)).participants;
    expect(row.nickname).toBe('Ada L.');
    expect(row.votes).toEqual({ [b.id]: 'no' }); // the vote for `a` is gone, not kept
  });

  it('lets the admin edit anyone and keeps the nickname when none is sent', async () => {
    const poll = await createPoll();
    const [a] = poll.view.options;
    const them = await addParticipant(client(), poll.id, 'Grace');
    const res = await poll.client.put(
      `/api/events/${poll.id}/participants/${them.id}`,
      { votes: { [a.id]: 'maybe' } },
      bearer(poll.adminToken),
    );
    expect(res.status).toBe(204);
    const [row] = (await getView(poll.client, poll.id)).participants;
    expect(row).toMatchObject({ nickname: 'Grace', votes: { [a.id]: 'maybe' } });
  });

  it('rejects strangers, other participants and participant ids from other polls', async () => {
    const poll = await createPoll();
    const other = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    const grace = await addParticipant(client(), poll.id, 'Grace');
    const path = `/api/events/${poll.id}/participants/${ada.id}`;

    expect((await poll.client.put(path, { votes: {} })).body).toMatchObject({ code: 'not_owner' });
    expect((await poll.client.put(path, { votes: {} }, asParticipant(grace))).status).toBe(403);
    expect(
      (await poll.client.put(path, { votes: {} }, { ...asParticipant(ada), Authorization: 'Bearer nope' })).status,
    ).toBe(403);
    // Ada's token is valid, but not for a participant that belongs to another poll.
    expect(
      (await poll.client.put(`/api/events/${other.id}/participants/${ada.id}`, { votes: {} }, asParticipant(ada)))
        .status,
    ).toBe(403);
  });

  it('refuses a rename onto a nickname someone else uses', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    await addParticipant(client(), poll.id, 'Grace');
    const res = await poll.client.put(
      `/api/events/${poll.id}/participants/${ada.id}`,
      { nickname: 'grace', votes: {} },
      asParticipant(ada),
    );
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'nickname_taken' });
    // Keeping your own nickname, in any case, is fine.
    const same = await poll.client.put(
      `/api/events/${poll.id}/participants/${ada.id}`,
      { nickname: 'Ada', votes: {} },
      asParticipant(ada),
    );
    expect(same.status).toBe(204);
  });
});

describe('DELETE /api/events/:id/participants/:participantId', () => {
  it('lets the owner leave and the admin remove anyone, once', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada', { [poll.view.options[0].id]: 'yes' });
    const grace = await addParticipant(client(), poll.id, 'Grace');

    expect((await poll.client.delete(`/api/events/${poll.id}/participants/${ada.id}`, asParticipant(ada))).status).toBe(
      204,
    );
    expect(
      (await poll.client.delete(`/api/events/${poll.id}/participants/${grace.id}`, bearer(poll.adminToken))).status,
    ).toBe(204);
    expect(
      (await poll.client.delete(`/api/events/${poll.id}/participants/${grace.id}`, bearer(poll.adminToken))).status,
    ).toBe(404);
    expect((await getView(poll.client, poll.id)).participants).toEqual([]);
  });

  it('rejects strangers', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    const grace: CreateParticipantResponse = await addParticipant(client(), poll.id, 'Grace');
    const res = await poll.client.delete(`/api/events/${poll.id}/participants/${ada.id}`, asParticipant(grace));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'not_owner' });
  });
});
