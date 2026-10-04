import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '@shared/limits';
import type { CreateParticipantResponse } from '@shared/types';
import { sha256Hex } from '../lib/crypto';
import {
  DUMMY_TOKEN,
  addParticipant,
  asParticipant,
  bearer,
  client,
  countRows,
  createPoll,
  forbidOutboundFetch,
  futureIso,
  getView,
  siteverifyOk,
  stubSiteverify,
  stubSiteverifyDown,
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
      name: 'Ada',
      votes: { [a.id]: 'yes', [b.id]: 'maybe' },
    });
  });

  it('marks the row as the organiser when the join carries the admin token, and only then', async () => {
    const poll = await createPoll();
    stubSiteverify(siteverifyOk('answer'));
    const asOrganiser = await poll.client.post<CreateParticipantResponse>(
      `/api/events/${poll.id}/participants`,
      { name: 'Host', votes: {}, turnstileToken: DUMMY_TOKEN },
      bearer(poll.adminToken),
    );
    expect(asOrganiser.status).toBe(201);
    const guest = await addParticipant(client(), poll.id, 'Guest');
    stubSiteverify(siteverifyOk('answer'));
    const wrongToken = await client().post<CreateParticipantResponse>(
      `/api/events/${poll.id}/participants`,
      { name: 'Pretender', votes: {}, turnstileToken: DUMMY_TOKEN },
      bearer('not-the-admin-token'),
    );
    expect(wrongToken.status).toBe(201);

    const view = await getView(poll.client, poll.id);
    expect(view.participants.map((p) => [p.name, p.isOrganiser])).toEqual([
      ['Host', true],
      ['Guest', false],
      ['Pretender', false],
    ]);
    expect(view.participants[1].id).toBe(guest.id);
  });

  it('requires a token solved for the answer action on this hostname', async () => {
    const poll = await createPoll();
    stubSiteverify(siteverifyOk('create'));
    const wrongAction = await poll.client.post(`/api/events/${poll.id}/participants`, {
      name: 'Ada',
      votes: {},
      turnstileToken: DUMMY_TOKEN,
    });
    expect(wrongAction.status).toBe(403);
    expect(wrongAction.body).toMatchObject({ code: 'captcha_failed' });
    stubSiteverify(siteverifyOk('answer', 'other.example'));
    const wrongHost = await poll.client.post(`/api/events/${poll.id}/participants`, {
      name: 'Ada',
      votes: {},
      turnstileToken: DUMMY_TOKEN,
    });
    expect(wrongHost.status).toBe(403);
  });

  it('answers 503 when siteverify is down, so the client can retry instead of being refused', async () => {
    const poll = await createPoll();
    stubSiteverifyDown();
    const res = await poll.client.post(`/api/events/${poll.id}/participants`, {
      name: 'Ada',
      votes: {},
      turnstileToken: DUMMY_TOKEN,
    });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'verification_unavailable' });
    expect(await countRows('participants', poll.id)).toBe(0);
  });

  it('rejects votes for dates outside the poll before contacting Turnstile', async () => {
    const poll = await createPoll();
    const fetchMock = forbidOutboundFetch();
    const res = await poll.client.post(`/api/events/${poll.id}/participants`, {
      name: 'Ada',
      votes: { 'not-an-option-id': 'yes' },
      turnstileToken: DUMMY_TOKEN,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'unknown_option' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a name already in use, ignoring case, before contacting Turnstile', async () => {
    const poll = await createPoll();
    await addParticipant(poll.client, poll.id, 'Ada');
    const fetchMock = forbidOutboundFetch();
    const res = await poll.client.post(`/api/events/${poll.id}/participants`, {
      name: 'ADA',
      votes: {},
      turnstileToken: DUMMY_TOKEN,
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'name_taken' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a name that differs only in non-ASCII case, Unicode spelling or spacing', async () => {
    const poll = await createPoll();
    await addParticipant(poll.client, poll.id, 'Äiti Öberg');
    forbidOutboundFetch();
    for (const name of ['äiti öberg', 'Äiti Öberg', 'Äiti   Öberg', 'Äi​ti Öberg']) {
      const res = await poll.client.post(`/api/events/${poll.id}/participants`, {
        name,
        votes: {},
        turnstileToken: DUMMY_TOKEN,
      });
      expect(res.status, name).toBe(409);
      expect(res.body).toMatchObject({ code: 'name_taken' });
    }
  });

  it('lets exactly one of several simultaneous answers with the same name in', async () => {
    const poll = await createPoll();
    stubSiteverify(siteverifyOk('answer'));
    const attempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        poll.client.post(`/api/events/${poll.id}/participants`, {
          name: 'Racer',
          votes: {},
          turnstileToken: DUMMY_TOKEN,
        }),
      ),
    );
    const statuses = attempts.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect((await getView(poll.client, poll.id)).participants.filter((p) => p.name === 'Racer')).toHaveLength(1);
  });

  it('compares names with rows from before migration 0006, whose keys are ASCII-only or missing', async () => {
    const poll = await createPoll();
    const now = Date.now();
    const legacy = (id: string, name: string, key: string | null) =>
      env.DB.prepare(
        'INSERT INTO participants (id, event_id, name, name_key, edit_token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(`${id}-${poll.id.slice(0, 8)}`, poll.id, name, key, 'nohash', now, now);
    // What the migration's lower() backfill gives "Äiti", and a row an older Worker inserted without a key.
    await env.DB.batch([legacy('backfilled', 'Äiti', 'Äiti'), legacy('keyless', 'Ada', null)]);
    forbidOutboundFetch();
    for (const name of ['äiti', 'ADA']) {
      const res = await poll.client.post(`/api/events/${poll.id}/participants`, {
        name,
        votes: {},
        turnstileToken: DUMMY_TOKEN,
      });
      expect(res.status, name).toBe(409);
      expect(res.body).toMatchObject({ code: 'name_taken' });
    }
  });

  it('keeps the case-insensitive index as a backstop for rows without a key', async () => {
    const poll = await createPoll();
    const now = Date.now();
    const insert = (id: string, name: string) =>
      env.DB.prepare(
        'INSERT INTO participants (id, event_id, name, edit_token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind(`${id}-${poll.id.slice(0, 8)}`, poll.id, name, 'nohash', now, now)
        .run();
    await insert('first', 'Ada');
    await expect(insert('second', 'ADA')).rejects.toThrow(/UNIQUE/);
  });

  it('lets only one of two simultaneous answers in when the names differ only in non-ASCII case', async () => {
    const poll = await createPoll();
    stubSiteverify(siteverifyOk('answer'));
    const attempts = await Promise.all(
      ['Äiti', 'äiti'].map((name) =>
        poll.client.post(`/api/events/${poll.id}/participants`, { name, votes: {}, turnstileToken: DUMMY_TOKEN }),
      ),
    );
    expect(attempts.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('refuses a full poll before contacting Turnstile', async () => {
    const poll = await createPoll();
    const now = Date.now();
    await env.DB.batch(
      Array.from({ length: LIMITS.participantsMax }, (_, i) =>
        env.DB.prepare(
          'INSERT INTO participants (id, event_id, name, edit_token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(`filler-${poll.id.slice(0, 8)}-${i}`, poll.id, `Filler ${i}`, 'nohash', now, now),
      ),
    );
    const fetchMock = forbidOutboundFetch();
    const res = await poll.client.post(`/api/events/${poll.id}/participants`, {
      name: 'Late',
      votes: {},
      turnstileToken: DUMMY_TOKEN,
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'event_full' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates name and vote values', async () => {
    const poll = await createPoll();
    forbidOutboundFetch();
    const res = await poll.client.post(`/api/events/${poll.id}/participants`, {
      name: 'x'.repeat(LIMITS.nameMax + 1),
      votes: { [poll.view.options[0].id]: 'perhaps' },
      turnstileToken: DUMMY_TOKEN,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'validation_failed' });
  });
});

describe('GET /api/events/:id/participants/:participantId', () => {
  it('validates an existing edit token repeatedly without rotating it or exposing credentials', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada', { [poll.view.options[0].id]: 'yes' });
    const path = `/api/events/${poll.id}/participants/${ada.id}`;
    const stored = await env.DB.prepare('SELECT edit_token_hash FROM participants WHERE id = ?')
      .bind(ada.id)
      .first<{ edit_token_hash: string }>();
    expect(stored?.edit_token_hash).toBe(await sha256Hex(ada.editToken));
    expect(stored?.edit_token_hash).not.toBe(ada.editToken);

    // A different client address, as when the private link is opened on another device.
    const otherDevice = client();
    for (let i = 0; i < 2; i++) {
      const res = await otherDevice.get(path, bearer(ada.editToken));
      expect(res.status).toBe(204);
      expect(res.body).toBeNull();
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(
      (await otherDevice.put(path, { votes: { [poll.view.options[0].id]: 'maybe' } }, asParticipant(ada))).status,
    ).toBe(204);
    expect((await getView(poll.client, poll.id)).participants[0].votes).toEqual({
      [poll.view.options[0].id]: 'maybe',
    });
  });

  it('rejects missing, guessed, another participant, admin and database-hash tokens', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    const grace = await addParticipant(poll.client, poll.id, 'Grace');
    expect(ada.editToken).not.toBe(grace.editToken);
    const path = `/api/events/${poll.id}/participants/${ada.id}`;
    for (const headers of [
      undefined,
      bearer('x'.repeat(43)),
      bearer(grace.editToken),
      bearer(poll.adminToken),
      bearer(await sha256Hex(ada.editToken)),
    ]) {
      const res = await poll.client.get(path, headers);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'not_owner' });
    }
  });

  it('rejects a real token with a different participant id or poll id', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    const otherPoll = await createPoll();
    const otherAda = await addParticipant(otherPoll.client, otherPoll.id, 'Ada');
    expect(otherAda.editToken).not.toBe(ada.editToken);
    for (const path of [
      `/api/events/${poll.id}/participants/${otherAda.id}`,
      `/api/events/${otherPoll.id}/participants/${ada.id}`,
      `/api/events/${poll.id}/participants/missing`,
    ]) {
      expect((await poll.client.get(path, bearer(ada.editToken))).status).toBe(403);
    }
  });

  it('invalidates private links when the participant is deleted or the poll expires or is deleted', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    const grace = await addParticipant(poll.client, poll.id, 'Grace');
    const path = `/api/events/${poll.id}/participants/${ada.id}`;
    expect((await poll.client.delete(path, asParticipant(ada))).status).toBe(204);
    expect((await poll.client.get(path, asParticipant(ada))).status).toBe(403);

    await env.DB.prepare('UPDATE events SET expires_at = ? WHERE id = ?')
      .bind(Date.now() - 1, poll.id)
      .run();
    expect(
      (await poll.client.get(`/api/events/${poll.id}/participants/${grace.id}`, asParticipant(grace))).status,
    ).toBe(410);
    await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(poll.id).run();
    expect(
      (await poll.client.get(`/api/events/${poll.id}/participants/${grace.id}`, asParticipant(grace))).status,
    ).toBe(404);
  });
});

describe('PUT /api/events/:id/participants/:participantId', () => {
  it('changes only what is sent: a name-only save keeps the votes, a votes-only save keeps the name', async () => {
    const poll = await createPoll();
    const [a, b] = poll.view.options;
    const me = await addParticipant(poll.client, poll.id, 'Ada', { [a.id]: 'yes' });
    const path = `/api/events/${poll.id}/participants/${me.id}`;

    expect((await poll.client.put(path, { name: 'Ada L.' }, asParticipant(me))).status).toBe(204);
    let [row] = (await getView(poll.client, poll.id)).participants;
    expect(row).toMatchObject({ name: 'Ada L.', votes: { [a.id]: 'yes' } });

    expect((await poll.client.put(path, { votes: { [b.id]: 'maybe' } }, asParticipant(me))).status).toBe(204);
    [row] = (await getView(poll.client, poll.id)).participants;
    expect(row).toMatchObject({ name: 'Ada L.', votes: { [b.id]: 'maybe' } });

    const empty = await poll.client.put(path, {}, asParticipant(me));
    expect(empty.status).toBe(400);
    expect(empty.body).toMatchObject({ code: 'validation_failed' });
  });

  it('keeps a page loaded before the rename working: nickname in, nickname alias out', async () => {
    const poll = await createPoll();
    stubSiteverify(siteverifyOk('answer'));
    const legacy = await poll.client.post<CreateParticipantResponse>(`/api/events/${poll.id}/participants`, {
      nickname: 'Ada',
      votes: {},
      turnstileToken: DUMMY_TOKEN,
    });
    expect(legacy.status).toBe(201);
    const renamed = await poll.client.put(
      `/api/events/${poll.id}/participants/${legacy.body.id}`,
      { nickname: 'Ada L.', votes: {} },
      asParticipant(legacy.body),
    );
    expect(renamed.status).toBe(204);
    const [row] = (await getView(poll.client, poll.id)).participants;
    expect(row.name).toBe('Ada L.');
    expect(row.nickname).toBe('Ada L.');
  });

  it('lets the owner replace name and votes as a whole', async () => {
    const poll = await createPoll();
    const [a, b] = poll.view.options;
    const me = await addParticipant(poll.client, poll.id, 'Ada', { [a.id]: 'yes', [b.id]: 'yes' });
    const res = await poll.client.put(
      `/api/events/${poll.id}/participants/${me.id}`,
      { name: 'Ada L.', votes: { [b.id]: 'no' } },
      asParticipant(me),
    );
    expect(res.status).toBe(204);
    const [row] = (await getView(poll.client, poll.id)).participants;
    expect(row.name).toBe('Ada L.');
    expect(row.votes).toEqual({ [b.id]: 'no' }); // the vote for `a` is gone, not kept
  });

  it('lets the admin edit anyone and keeps the name when none is sent', async () => {
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
    expect(row).toMatchObject({ name: 'Grace', votes: { [a.id]: 'maybe' } });
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

  it('refuses a rename onto a name someone else uses', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    await addParticipant(client(), poll.id, 'Grace');
    const res = await poll.client.put(
      `/api/events/${poll.id}/participants/${ada.id}`,
      { name: 'grace', votes: {} },
      asParticipant(ada),
    );
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'name_taken' });
    // Keeping your own name, in any case, is fine.
    const same = await poll.client.put(
      `/api/events/${poll.id}/participants/${ada.id}`,
      { name: 'Ada', votes: {} },
      asParticipant(ada),
    );
    expect(same.status).toBe(204);
  });

  it('refuses a rename onto a name that differs only in non-ASCII case or spacing, but allows restyling your own', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    await addParticipant(client(), poll.id, 'Örjan Ström');
    const path = `/api/events/${poll.id}/participants/${ada.id}`;
    for (const name of ['örjan ström', 'Örjan  Ström']) {
      const res = await poll.client.put(path, { name }, asParticipant(ada));
      expect(res.status, name).toBe(409);
      expect(res.body).toMatchObject({ code: 'name_taken' });
    }
    expect((await poll.client.put(path, { name: 'Äda' }, asParticipant(ada))).status).toBe(204);
    // The new name's key replaced the old one: a newcomer may take "Ada" now, but not "äda".
    expect((await addParticipant(client(), poll.id, 'Ada')).id).toBeTruthy();
    stubSiteverify(siteverifyOk('answer'));
    const taken = await poll.client.post(`/api/events/${poll.id}/participants`, {
      name: 'äda',
      votes: {},
      turnstileToken: DUMMY_TOKEN,
    });
    expect(taken.status).toBe(409);
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

describe('PUT /api/events/:id/participants/:participantId/disabled', () => {
  const disabledPath = (eventId: string, participantId: string) =>
    `/api/events/${eventId}/participants/${participantId}/disabled`;

  it('lets only the organiser disable and enable a participant', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    const grace = await addParticipant(client(), poll.id, 'Grace');
    const path = disabledPath(poll.id, ada.id);

    for (const headers of [{}, asParticipant(ada), asParticipant(grace)]) {
      const res = await poll.client.put(path, { disabled: true }, headers);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'admin_required' });
    }
    expect((await poll.client.put(path, { disabled: 'yes' }, bearer(poll.adminToken))).status).toBe(400);
    expect(
      (await poll.client.put(disabledPath(poll.id, 'nobody'), { disabled: true }, bearer(poll.adminToken))).status,
    ).toBe(404);

    expect((await poll.client.put(path, { disabled: true }, bearer(poll.adminToken))).status).toBe(204);
    expect((await getView(poll.client, poll.id, bearer(poll.adminToken))).participants[0].isDisabled).toBe(true);
    expect((await poll.client.put(path, { disabled: false }, bearer(poll.adminToken))).status).toBe(204);
    expect((await getView(poll.client, poll.id, bearer(poll.adminToken))).participants[0].isDisabled).toBe(false);
  });

  it('hides a disabled participant from everyone but the organiser and themselves, until enabled again', async () => {
    const poll = await createPoll();
    const [a] = poll.view.options;
    const ada = await addParticipant(poll.client, poll.id, 'Ada', { [a.id]: 'yes' });
    const grace = await addParticipant(client(), poll.id, 'Grace', { [a.id]: 'maybe' });
    await poll.client.put(disabledPath(poll.id, ada.id), { disabled: true }, bearer(poll.adminToken));

    const names = async (headers?: Record<string, string>) =>
      (await getView(poll.client, poll.id, headers)).participants.map((p) => `${p.name}${p.isDisabled ? '!' : ''}`);
    expect(await names()).toEqual(['Grace']);
    expect(await names(asParticipant(grace))).toEqual(['Grace']);
    // Ada's id with someone else's token proves nothing.
    expect(await names({ ...asParticipant(grace), 'X-Participant-Id': ada.id })).toEqual(['Grace']);
    expect(await names(asParticipant(ada))).toEqual(['Ada!', 'Grace']);
    expect(await names(bearer(poll.adminToken))).toEqual(['Ada!', 'Grace']);

    await poll.client.put(disabledPath(poll.id, ada.id), { disabled: false }, bearer(poll.adminToken));
    const view = await getView(poll.client, poll.id);
    expect(view.participants.map((p) => p.name)).toEqual(['Ada', 'Grace']);
    expect(view.participants[0].votes).toEqual({ [a.id]: 'yes' });
  });

  it("keeps a disabled participant's comments visible to everyone, marked", async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    expect((await poll.client.post(`/api/events/${poll.id}/comments`, { body: 'Hi' }, asParticipant(ada))).status).toBe(
      201,
    );
    await poll.client.put(disabledPath(poll.id, ada.id), { disabled: true }, bearer(poll.adminToken));
    expect((await getView(poll.client, poll.id)).comments).toEqual([
      expect.objectContaining({ name: 'Ada', body: 'Hi', isDisabled: true }),
    ]);
  });

  it("refuses a disabled participant's own writes but lets the organiser change their row", async () => {
    const poll = await createPoll();
    const [a] = poll.view.options;
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    await poll.client.put(disabledPath(poll.id, ada.id), { disabled: true }, bearer(poll.adminToken));
    const path = `/api/events/${poll.id}/participants/${ada.id}`;

    const refused = [
      await poll.client.put(path, { name: 'Ada B' }, asParticipant(ada)),
      await poll.client.put(path, { votes: { [a.id]: 'yes' } }, asParticipant(ada)),
      await poll.client.delete(path, asParticipant(ada)),
      await poll.client.post(`/api/events/${poll.id}/comments`, { body: 'Let me in' }, asParticipant(ada)),
      await poll.client.post(`/api/events/${poll.id}/options`, { date: futureIso(20) }, asParticipant(ada)),
    ];
    for (const res of refused) {
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'participant_disabled' });
    }

    expect((await poll.client.put(path, { votes: { [a.id]: 'no' } }, bearer(poll.adminToken))).status).toBe(204);
    expect((await poll.client.delete(path, bearer(poll.adminToken))).status).toBe(204);
  });

  it("keeps a disabled participant's name reserved", async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    await poll.client.put(disabledPath(poll.id, ada.id), { disabled: true }, bearer(poll.adminToken));
    forbidOutboundFetch();
    const res = await poll.client.post(`/api/events/${poll.id}/participants`, {
      name: 'ada',
      votes: {},
      turnstileToken: DUMMY_TOKEN,
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'name_taken' });
  });
});
