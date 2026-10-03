import { describe, expect, it } from 'vitest';
import type { EventView } from '@shared/types';
import { appReducer, hasParticipant, initialAppState, parseAdminHash, type AppState } from './app';

const me = { id: 'p1', token: 'tok-p1' };

const event = (overrides: Partial<EventView> = {}): EventView => ({
  id: 'ev1',
  title: 'Dinner',
  description: '',
  allowSuggestions: true,
  createdAt: 0,
  expiresAt: 1,
  options: [],
  participants: [{ id: 'p1', nickname: 'Ada', votes: {}, createdAt: 0 }],
  comments: [],
  viewer: { isAdmin: true },
  ...overrides,
});

const open = (state: AppState = initialAppState, id = 'ev1'): AppState =>
  appReducer(state, { type: 'poll/open', id, adminToken: 'admin-tok', me });

const loaded = (state: AppState = open(), view = event()): AppState =>
  appReducer(state, { type: 'poll/loaded', id: 'ev1', event: view });

const transient = { message: 'Network error.', gone: false };
const gone = { message: 'This poll does not exist or was deleted.', gone: true };

describe('appReducer', () => {
  it('starts a session with no event and no error, replacing any previous one', () => {
    const next = open(loaded(), 'ev2');
    expect(next.poll).toEqual({ id: 'ev2', adminToken: 'admin-tok', me, event: null, error: null });
  });

  it('stores a loaded event for the current poll and clears a previous error', () => {
    const failed = appReducer(open(), { type: 'poll/failed', id: 'ev1', error: transient });
    const next = loaded(failed);
    expect(next.poll?.event?.title).toBe('Dinner');
    expect(next.poll?.error).toBeNull();
  });

  it('ignores a load result or failure for a poll that is no longer current', () => {
    const state = open();
    expect(appReducer(state, { type: 'poll/loaded', id: 'other', event: event({ id: 'other' }) })).toBe(state);
    expect(appReducer(state, { type: 'poll/failed', id: 'other', error: transient })).toBe(state);
  });

  it('keeps the identity while the participant is in the poll and drops it once they are gone', () => {
    const present = loaded();
    expect(present.poll?.me).toEqual(me);
    const left = loaded(present, event({ participants: [] }));
    expect(left.poll?.me).toBeNull();
  });

  it('drops an admin token the server did not accept', () => {
    expect(loaded().poll?.adminToken).toBe('admin-tok');
    expect(loaded(open(), event({ viewer: { isAdmin: false } })).poll?.adminToken).toBeNull();
  });

  it('records a failed first load for the current poll', () => {
    const failed = appReducer(open(), { type: 'poll/failed', id: 'ev1', error: transient });
    expect(failed.poll?.error).toEqual(transient);
    expect(failed.poll?.event).toBeNull();
  });

  it('keeps a loaded event through a transient refresh failure and reports the error beside it', () => {
    const failed = appReducer(loaded(), { type: 'poll/failed', id: 'ev1', error: transient });
    expect(failed.poll?.event?.title).toBe('Dinner');
    expect(failed.poll?.error).toEqual(transient);
  });

  it('drops the loaded event when the server says the poll is gone', () => {
    const failed = appReducer(loaded(), { type: 'poll/failed', id: 'ev1', error: gone });
    expect(failed.poll?.event).toBeNull();
    expect(failed.poll?.error).toEqual(gone);
  });

  it('sets the identity for the current poll only', () => {
    const other = { id: 'p2', token: 'tok-p2' };
    expect(appReducer(open(), { type: 'poll/identity', id: 'ev1', me: other }).poll?.me).toEqual(other);
    expect(appReducer(open(), { type: 'poll/identity', id: 'ev1', me: null }).poll?.me).toBeNull();
    const state = open();
    expect(appReducer(state, { type: 'poll/identity', id: 'ev2', me: other })).toBe(state);
    expect(appReducer(initialAppState, { type: 'poll/identity', id: 'ev1', me })).toBe(initialAppState);
  });

  it('closes the session for the current poll only', () => {
    expect(appReducer(open(), { type: 'poll/close', id: 'ev1' })).toEqual({ poll: null });
    const state = open();
    expect(appReducer(state, { type: 'poll/close', id: 'ev2' })).toBe(state);
    expect(appReducer(initialAppState, { type: 'poll/close', id: 'ev1' })).toBe(initialAppState);
  });
});

describe('hasParticipant', () => {
  it('is true only when the identity names a participant in the event', () => {
    expect(hasParticipant(event(), me)).toBe(true);
    expect(hasParticipant(event({ participants: [] }), me)).toBe(false);
    expect(hasParticipant(event(), null)).toBe(false);
  });
});

describe('parseAdminHash', () => {
  it('reads the admin token out of the fragment, alone or among other keys', () => {
    expect(parseAdminHash('#admin=abc_-1')).toBe('abc_-1');
    expect(parseAdminHash('#x=1&admin=t')).toBe('t');
  });

  it('returns null when there is no admin key', () => {
    expect(parseAdminHash('')).toBeNull();
    expect(parseAdminHash('#other=1')).toBeNull();
  });
});
