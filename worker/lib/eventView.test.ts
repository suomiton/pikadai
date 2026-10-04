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
    {
      id: 'p1',
      event_id: 'ev1',
      name: 'Ada',
      edit_token_hash: 'h1',
      is_organiser: 0,
      is_disabled: 0,
      created_at: 1_100,
      updated_at: 1_100,
    },
    {
      id: 'p2',
      event_id: 'ev1',
      name: 'Grace',
      edit_token_hash: 'h2',
      is_organiser: 1,
      is_disabled: 0,
      created_at: 1_200,
      updated_at: 1_200,
    },
  ],
  votes: [
    { participant_id: 'p1', option_id: 'o1', answer: 'yes' },
    { participant_id: 'p1', option_id: 'o2', answer: 'maybe' },
  ],
  comments: [
    {
      id: 'c1',
      event_id: 'ev1',
      participant_id: 'p2',
      body: 'I can host.',
      created_at: 1_300,
      name: 'Grace',
      is_organiser: 1,
      is_disabled: 0,
    },
  ],
};

const guest = { isAdmin: false, participantId: null };
const organiser = { isAdmin: true, participantId: null };

describe('toEventView', () => {
  it('maps the event columns, turning the integer flag into a boolean', () => {
    const view = toEventView(event, rows, guest);
    expect(view).toMatchObject({
      id: 'ev1',
      title: 'Dinner',
      description: 'Somewhere central',
      allowSuggestions: false,
      createdAt: 1_000,
      expiresAt: 3_000,
    });
    expect(toEventView({ ...event, allow_suggestions: 1 }, rows, guest).allowSuggestions).toBe(true);
  });

  it('maps options with who suggested them', () => {
    expect(toEventView(event, rows, guest).options).toEqual([
      { id: 'o1', date: '2026-10-15', suggestedBy: null },
      { id: 'o2', date: '2026-10-16', suggestedBy: 'p1' },
    ]);
  });

  it('groups votes by participant and gives a participant without votes an empty map', () => {
    const [ada, grace] = toEventView(event, rows, guest).participants;
    expect(ada).toEqual({
      id: 'p1',
      name: 'Ada',
      nickname: 'Ada',
      votes: { o1: 'yes', o2: 'maybe' },
      createdAt: 1_100,
      isOrganiser: false,
      isDisabled: false,
    });
    expect(grace.votes).toEqual({});
    expect(grace.isOrganiser).toBe(true);
  });

  it('maps comments with the name the join supplied', () => {
    expect(toEventView(event, rows, guest).comments).toEqual([
      {
        id: 'c1',
        participantId: 'p2',
        name: 'Grace',
        isOrganiser: true,
        isDisabled: false,
        body: 'I can host.',
        createdAt: 1_300,
      },
    ]);
    expect(toEventView(event, { ...rows, comments: [] }, guest).comments).toEqual([]);
  });

  it('reports the viewer role it is given', () => {
    expect(toEventView(event, rows, organiser).viewer).toEqual({ isAdmin: true });
    expect(toEventView(event, rows, guest).viewer).toEqual({ isAdmin: false });
  });

  describe('a disabled participant', () => {
    const disabledAda: EventRows = {
      ...rows,
      participants: rows.participants.map((p) => (p.id === 'p1' ? { ...p, is_disabled: 1 } : p)),
      comments: [{ ...rows.comments[0], id: 'c2', participant_id: 'p1', name: 'Ada', is_organiser: 0, is_disabled: 1 }],
    };

    it('is left out, with their answers, for everyone but the organiser and themselves', () => {
      const view = toEventView(event, disabledAda, guest);
      expect(view.participants.map((p) => p.id)).toEqual(['p2']);
      expect(toEventView(event, disabledAda, { isAdmin: false, participantId: 'p2' }).participants).toHaveLength(1);
    });

    it('is shown to the organiser, marked, with their answers', () => {
      const [ada] = toEventView(event, disabledAda, organiser).participants;
      expect(ada).toMatchObject({ id: 'p1', isDisabled: true, votes: { o1: 'yes', o2: 'maybe' } });
    });

    it('still sees their own row, marked', () => {
      const view = toEventView(event, disabledAda, { isAdmin: false, participantId: 'p1' });
      expect(view.participants.map((p) => [p.id, p.isDisabled])).toEqual([
        ['p1', true],
        ['p2', false],
      ]);
    });

    it('keeps their comments visible to everyone, marked', () => {
      expect(toEventView(event, disabledAda, guest).comments).toEqual([
        expect.objectContaining({ id: 'c2', name: 'Ada', isDisabled: true }),
      ]);
    });
  });
});
