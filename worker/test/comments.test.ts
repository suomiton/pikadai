import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '@shared/limits';
import type { Comment, CreateParticipantResponse } from '@shared/types';
import {
  DUMMY_TOKEN,
  addParticipant,
  asParticipant,
  bearer,
  client,
  countRows,
  createPoll,
  getView,
  siteverifyOk,
  stubSiteverify,
} from './helpers';

describe('POST /api/events/:id/comments', () => {
  it('posts a comment under the participant name and lists it in the view, oldest first', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    const grace = await addParticipant(client(), poll.id, 'Grace');

    const first = await poll.client.post<Comment>(
      `/api/events/${poll.id}/comments`,
      { body: '  I can host if Saturday wins. ' },
      asParticipant(ada),
    );
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      participantId: ada.id,
      name: 'Ada',
      isOrganiser: false,
      body: 'I can host if Saturday wins.',
    });
    expect(first.body.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(first.body.createdAt).toBeGreaterThan(0);

    const second = await poll.client.post<Comment>(
      `/api/events/${poll.id}/comments`,
      { body: 'Saturday works, I will bring dice.' },
      asParticipant(grace),
    );
    expect(second.status).toBe(201);

    const view = await getView(poll.client, poll.id);
    expect(view.comments.map((c) => [c.name, c.body])).toEqual([
      ['Ada', 'I can host if Saturday wins.'],
      ['Grace', 'Saturday works, I will bring dice.'],
    ]);
    expect(view.comments[0]).toEqual(first.body);
  });

  it('refuses strangers, the admin token and a token for another participant', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    const grace = await addParticipant(client(), poll.id, 'Grace');
    const path = `/api/events/${poll.id}/comments`;
    const body = { body: 'Hello' };

    const anonymous = await poll.client.post(path, body);
    expect(anonymous.status).toBe(403);
    expect(anonymous.body).toMatchObject({ code: 'not_participant' });
    expect((await poll.client.post(path, body, bearer(poll.adminToken))).status).toBe(403);
    expect((await poll.client.post(path, body, { ...asParticipant(ada), 'X-Participant-Id': grace.id })).status).toBe(
      403,
    );
    expect((await poll.client.post(path, body, { ...asParticipant(ada), Authorization: 'Bearer nope' })).status).toBe(
      403,
    );
    expect(await countRows('comments', poll.id)).toBe(0);
  });

  it('rejects a participant id that belongs to another poll', async () => {
    const poll = await createPoll();
    const other = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    const res = await poll.client.post(`/api/events/${other.id}/comments`, { body: 'Hello' }, asParticipant(ada));
    expect(res.status).toBe(403);
  });

  it('validates the text: required, trimmed, at most the shared limit', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    const path = `/api/events/${poll.id}/comments`;

    const blank = await poll.client.post(path, { body: '   ' }, asParticipant(ada));
    expect(blank.status).toBe(400);
    expect(blank.body).toMatchObject({ code: 'validation_failed' });
    const long = await poll.client.post(path, { body: 'x'.repeat(LIMITS.commentMax + 1) }, asParticipant(ada));
    expect(long.status).toBe(400);
    const longest = await poll.client.post(path, { body: 'x'.repeat(LIMITS.commentMax) }, asParticipant(ada));
    expect(longest.status).toBe(201);
  });

  it('allows one comment per interval per participant, and others are unaffected', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    const grace = await addParticipant(client(), poll.id, 'Grace');
    const path = `/api/events/${poll.id}/comments`;

    const first = await poll.client.post<Comment>(path, { body: 'One' }, asParticipant(ada));
    expect(first.status).toBe(201);
    const tooSoon = await poll.client.post(path, { body: 'Two' }, asParticipant(ada));
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body).toMatchObject({ code: 'comment_too_soon' });
    expect((await poll.client.post(path, { body: 'Hi' }, asParticipant(grace))).status).toBe(201);

    // Once the first comment is old enough the next one goes through.
    await env.DB.prepare('UPDATE comments SET created_at = ? WHERE id = ?')
      .bind(first.body.createdAt - LIMITS.commentIntervalMs - 1, first.body.id)
      .run();
    expect((await poll.client.post(path, { body: 'Two' }, asParticipant(ada))).status).toBe(201);
    expect(await countRows('comments', poll.id)).toBe(3);
  });

  it('lets exactly one of several simultaneous posts by the same participant in', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        poll.client.post(`/api/events/${poll.id}/comments`, { body: `Racer ${i}` }, asParticipant(ada)),
      ),
    );
    expect(attempts.map((r) => r.status).sort()).toEqual([201, 429, 429, 429, 429]);
    expect(await countRows('comments', poll.id)).toBe(1);
  });

  it('refuses a poll that has reached the comment cap', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    const now = Date.now();
    await env.DB.batch(
      Array.from({ length: LIMITS.commentsMax }, (_, i) =>
        env.DB.prepare(
          'INSERT INTO comments (id, event_id, participant_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(
          `filler-${poll.id.slice(0, 8)}-${i}`,
          poll.id,
          ada.id,
          `Filler ${i}`,
          now - LIMITS.commentIntervalMs * 2,
        ),
      ),
    );
    const res = await poll.client.post(`/api/events/${poll.id}/comments`, { body: 'One more' }, asParticipant(ada));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'too_many_comments' });
  });

  it('follows the participant: a rename shows on old comments and removal takes them along', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    const grace = await addParticipant(client(), poll.id, 'Grace');
    await poll.client.post(`/api/events/${poll.id}/comments`, { body: 'From Ada' }, asParticipant(ada));
    await poll.client.post(`/api/events/${poll.id}/comments`, { body: 'From Grace' }, asParticipant(grace));

    await poll.client.put(
      `/api/events/${poll.id}/participants/${ada.id}`,
      { name: 'Ada L.', votes: {} },
      asParticipant(ada),
    );
    expect((await getView(poll.client, poll.id)).comments.map((c) => c.name)).toEqual(['Ada L.', 'Grace']);

    await poll.client.delete(`/api/events/${poll.id}/participants/${grace.id}`, bearer(poll.adminToken));
    expect((await getView(poll.client, poll.id)).comments.map((c) => c.body)).toEqual(['From Ada']);
    expect(await countRows('comments', poll.id)).toBe(1);
  });

  it('carries the organiser flag of its author', async () => {
    const poll = await createPoll();
    stubSiteverify(siteverifyOk('answer'));
    const host = await poll.client.post<CreateParticipantResponse>(
      `/api/events/${poll.id}/participants`,
      { name: 'Host', votes: {}, turnstileToken: DUMMY_TOKEN },
      bearer(poll.adminToken),
    );
    const posted = await poll.client.post<Comment>(
      `/api/events/${poll.id}/comments`,
      { body: 'Welcome, everyone.' },
      asParticipant(host.body),
    );
    expect(posted.status).toBe(201);
    expect(posted.body.isOrganiser).toBe(true);
    expect((await getView(poll.client, poll.id)).comments[0]).toMatchObject({ name: 'Host', isOrganiser: true });
  });

  it('is gone with the poll', async () => {
    const poll = await createPoll();
    const ada = await addParticipant(poll.client, poll.id, 'Ada');
    await poll.client.post(`/api/events/${poll.id}/comments`, { body: 'Bye' }, asParticipant(ada));
    await poll.client.delete(`/api/events/${poll.id}`, bearer(poll.adminToken));
    expect(await countRows('comments', poll.id)).toBe(0);
  });
});
