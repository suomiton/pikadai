import { describe, expect, it } from 'vitest';
import { LIMITS } from '@shared/limits';
import type { EventOption } from '@shared/types';
import { computeExpiresAt } from '../db/queries';
import { addParticipant, asParticipant, bearer, client, createPoll, futureIso, getView } from './helpers';

describe('POST /api/events/:id/options', () => {
  it('lets anyone suggest a date while suggestions are on, unattributed, and moves the expiry', async () => {
    const poll = await createPoll();
    const date = futureIso(40);
    const res = await client().post<EventOption>(`/api/events/${poll.id}/options`, { date });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ date, suggestedBy: null });

    const view = await getView(poll.client, poll.id);
    expect(view.options.map((o) => o.date)).toEqual([...poll.view.options.map((o) => o.date), date]);
    expect(view.expiresAt).toBe(computeExpiresAt([...poll.view.options.map((o) => o.date), date], view.createdAt));
    expect(view.expiresAt).toBeGreaterThan(poll.view.expiresAt);
  });

  it('attributes a suggestion to a participant who proves who they are', async () => {
    const poll = await createPoll();
    const me = await addParticipant(poll.client, poll.id, 'Ada');
    const attributed = await poll.client.post<EventOption>(
      `/api/events/${poll.id}/options`,
      { date: futureIso(20) },
      asParticipant(me),
    );
    expect(attributed.body.suggestedBy).toBe(me.id);
    // An id without the matching token proves nothing.
    const unproven = await poll.client.post<EventOption>(
      `/api/events/${poll.id}/options`,
      { date: futureIso(21) },
      { 'X-Participant-Id': me.id },
    );
    expect(unproven.body.suggestedBy).toBeNull();
  });

  it('refuses suggestions when they are off, except from the admin', async () => {
    const poll = await createPoll(client(), { allowSuggestions: false });
    const anon = await client().post(`/api/events/${poll.id}/options`, { date: futureIso(20) });
    expect(anon.status).toBe(403);
    expect(anon.body).toMatchObject({ code: 'suggestions_disabled' });
    const admin = await poll.client.post<EventOption>(
      `/api/events/${poll.id}/options`,
      { date: futureIso(20) },
      bearer(poll.adminToken),
    );
    expect(admin.status).toBe(201);
    expect(admin.body.suggestedBy).toBeNull();
  });

  it('rejects duplicate and impossible dates', async () => {
    const poll = await createPoll();
    const dup = await poll.client.post(`/api/events/${poll.id}/options`, { date: poll.view.options[0].date });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ code: 'date_exists' });
    const bad = await poll.client.post(`/api/events/${poll.id}/options`, { date: '2026-02-30' });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ code: 'validation_failed' });
  });

  it('caps the number of dates', async () => {
    const dates = Array.from({ length: LIMITS.optionsMax }, (_, i) => futureIso(10 + i));
    const poll = await createPoll(client(), { dates });
    const res = await poll.client.post(`/api/events/${poll.id}/options`, { date: futureIso(100) });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'too_many_options' });
  });
});

describe('DELETE /api/events/:id/options/:optionId', () => {
  it('is admin-only, drops the votes for that date and recomputes the expiry', async () => {
    const poll = await createPoll();
    const [keep, drop] = [...poll.view.options].sort((a, b) => (a.date < b.date ? -1 : 1));
    await addParticipant(poll.client, poll.id, 'Ada', { [keep.id]: 'yes', [drop.id]: 'yes' });

    const anon = await poll.client.delete(`/api/events/${poll.id}/options/${drop.id}`);
    expect(anon.status).toBe(403);

    const res = await poll.client.delete(`/api/events/${poll.id}/options/${drop.id}`, bearer(poll.adminToken));
    expect(res.status).toBe(204);
    const view = await getView(poll.client, poll.id);
    expect(view.options.map((o) => o.id)).toEqual([keep.id]);
    expect(view.participants[0].votes).toEqual({ [keep.id]: 'yes' });
    expect(view.expiresAt).toBe(computeExpiresAt([keep.date], view.createdAt));
  });

  it('404s for an option that is not in this poll', async () => {
    const poll = await createPoll();
    const other = await createPoll();
    const res = await poll.client.delete(
      `/api/events/${poll.id}/options/${other.view.options[0].id}`,
      bearer(poll.adminToken),
    );
    expect(res.status).toBe(404);
  });
});
