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
  viewer: { isAdmin: true },
  ...overrides,
});

const open = (state: AppState = initialAppState, id = 'ev1'): AppState =>
  appReducer(state, { type: 'poll/open', id, adminToken: 'admin-tok', me });

describe('appReducer', () => {
  it('starts a session with no event and no error, replacing any previous one', () => {
    const loaded = appReducer(open(), { type: 'poll/loaded', id: 'ev1', event: event() });
    const next = open(loaded, 'ev2');
    expect(next.poll).toEqual({ id: 'ev2', adminToken: 'admin-tok', me, event: null, error: null });
  });

  it('stores a loaded event for the current poll and clears a previous error', () => {
    const failed = appReducer(open(), { type: 'poll/failed', id: 'ev1', error: 'Network error.' });
    const loaded = appReducer(failed, { type: 'poll/loaded', id: 'ev1', event: event() });
    expect(loaded.poll?.event?.title).toBe('Dinner');
    expect(loaded.poll?.error).toBeNull();
  });

  it('ignores a load result or failure for a poll that is no longer current', () => {
    const state = open();
    expect(appReducer(state, { type: 'poll/loaded', id: 'other', event: event({ id: 'other' }) })).toBe(state);
    expect(appReducer(state, { type: 'poll/failed', id: 'other', error: 'x' })).toBe(state);
  });

  it('keeps the identity while the participant is in the poll and drops it once they are gone', () => {
    const present = appReducer(open(), { type: 'poll/loaded', id: 'ev1', event: event() });
    expect(present.poll?.me).toEqual(me);
    const gone = appReducer(present, { type: 'poll/loaded', id: 'ev1', event: event({ participants: [] }) });
    expect(gone.poll?.me).toBeNull();
  });

  it('drops an admin token the server did not accept', () => {
    const asAdmin = appReducer(open(), { type: 'poll/loaded', id: 'ev1', event: event() });
    expect(asAdmin.poll?.adminToken).toBe('admin-tok');
    const notAdmin = appReducer(open(), {
      type: 'poll/loaded',
      id: 'ev1',
      event: event({ viewer: { isAdmin: false } }),
    });
    expect(notAdmin.poll?.adminToken).toBeNull();
  });

  it('records a failed load for the current poll', () => {
    const failed = appReducer(open(), { type: 'poll/failed', id: 'ev1', error: 'Network error.' });
    expect(failed.poll?.error).toBe('Network error.');
    expect(failed.poll?.event).toBeNull();
  });

  it('sets the identity and closes the session', () => {
    const other = { id: 'p2', token: 'tok-p2' };
    expect(appReducer(open(), { type: 'poll/identity', me: other }).poll?.me).toEqual(other);
    expect(appReducer(open(), { type: 'poll/identity', me: null }).poll?.me).toBeNull();
    expect(appReducer(open(), { type: 'poll/close' })).toEqual({ poll: null });
  });

  it('ignores identity changes when no poll is open', () => {
    expect(appReducer(initialAppState, { type: 'poll/identity', me })).toBe(initialAppState);
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
