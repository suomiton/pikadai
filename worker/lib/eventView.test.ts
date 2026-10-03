import { describe, expect, it } from 'vitest';
import type { EventRow, EventRows } from '../db/queries';
import { toEventView } from './eventView';

const event: EventRow = {
  id: 'ev1',
  title: 'Dinner',
  description: 'Somewhere central',
  admin_token_hash: 'hash',
  allow_suggestions: 0,
  ticket_nonce: 'nonce',
  created_at: 1_000,
  updated_at: 2_000,
  expires_at: 3_000,
};

const rows: EventRows = {
  options: [
    { id: 'o1', event_id: 'ev1', date: '2026-10-15', suggested_by: null, created_at: 1_000 },
    { id: 'o2', event_id: 'ev1', date: '2026-10-16', suggested_by: 'p1', created_at: 1_500 },
  ],
  participants: [
    { id: 'p1', event_id: 'ev1', nickname: 'Ada', edit_token_hash: 'h1', created_at: 1_100, updated_at: 1_100 },
    { id: 'p2', event_id: 'ev1', nickname: 'Grace', edit_token_hash: 'h2', created_at: 1_200, updated_at: 1_200 },
  ],
  votes: [
    { participant_id: 'p1', option_id: 'o1', answer: 'yes' },
    { participant_id: 'p1', option_id: 'o2', answer: 'maybe' },
  ],
  comments: [
    { id: 'c1', event_id: 'ev1', participant_id: 'p2', body: 'I can host.', created_at: 1_300, nickname: 'Grace' },
  ],
};

describe('toEventView', () => {
  it('maps the event columns, turning the integer flag into a boolean', () => {
    const view = toEventView(event, rows, false);
    expect(view).toMatchObject({
      id: 'ev1',
      title: 'Dinner',
      description: 'Somewhere central',
      allowSuggestions: false,
      createdAt: 1_000,
      expiresAt: 3_000,
    });
    expect(toEventView({ ...event, allow_suggestions: 1 }, rows, false).allowSuggestions).toBe(true);
  });

  it('maps options with who suggested them', () => {
    expect(toEventView(event, rows, false).options).toEqual([
      { id: 'o1', date: '2026-10-15', suggestedBy: null },
      { id: 'o2', date: '2026-10-16', suggestedBy: 'p1' },
    ]);
  });

  it('groups votes by participant and gives a participant without votes an empty map', () => {
    const [ada, grace] = toEventView(event, rows, false).participants;
    expect(ada).toEqual({ id: 'p1', nickname: 'Ada', votes: { o1: 'yes', o2: 'maybe' }, createdAt: 1_100 });
    expect(grace.votes).toEqual({});
  });

  it('maps comments with the nickname the join supplied', () => {
    expect(toEventView(event, rows, false).comments).toEqual([
      { id: 'c1', participantId: 'p2', nickname: 'Grace', body: 'I can host.', createdAt: 1_300 },
    ]);
    expect(toEventView(event, { ...rows, comments: [] }, false).comments).toEqual([]);
  });

  it('reports the viewer role it is given', () => {
    expect(toEventView(event, rows, true).viewer).toEqual({ isAdmin: true });
    expect(toEventView(event, rows, false).viewer).toEqual({ isAdmin: false });
  });
});
