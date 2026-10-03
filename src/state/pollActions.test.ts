import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventView } from '@shared/types';
import { ApiRequestError } from '../lib/api';
import type { ParticipantIdentity } from '../lib/storage';
import { appReducer, initialAppState, type AppAction, type AppState } from './app';
import { createPollActions, type PollActionDeps, type PollActions } from './pollActions';

const me: ParticipantIdentity = { id: 'p1', token: 'tok-p1' };

const event = (overrides: Partial<EventView> = {}): EventView => ({
  id: 'ev1',
  title: 'Dinner',
  description: '',
  allowSuggestions: true,
  createdAt: 0,
  expiresAt: 1,
  options: [],
  participants: [{ id: 'p1', nickname: 'Ada', votes: {}, createdAt: 0 }],
  viewer: { isAdmin: false },
  ...overrides,
});

/** A Map-backed stand-in for localStorage access, keyed the way the real module keys it. */
function fakeStorage() {
  const admin = new Map<string, string>();
  const participants = new Map<string, ParticipantIdentity>();
  return {
    admin,
    participants,
    getAdminToken: (id: string) => admin.get(id) ?? null,
    setAdminToken: (id: string, token: string | null) =>
      void (token === null ? admin.delete(id) : admin.set(id, token)),
    getParticipant: (id: string) => participants.get(id) ?? null,
    setParticipant: (id: string, identity: ParticipantIdentity | null) =>
      void (identity === null ? participants.delete(id) : participants.set(id, identity)),
  };
}

/**
 * The actions under test with every dependency faked. Dispatched actions are run through the real
 * reducer so `getState` returns what the provider would hold after each one.
 */
function harness(hash = '') {
  let state: AppState = initialAppState;
  const storage = fakeStorage();
  const getEvent = vi.fn<PollActionDeps['api']['getEvent']>();
  const dispatched: AppAction[] = [];
  const location = { readHash: vi.fn(() => hash), clearHash: vi.fn(() => void (hash = '')) };
  const actions: PollActions = createPollActions({
    api: { getEvent },
    storage,
    dispatch: (action) => {
      dispatched.push(action);
      state = appReducer(state, action);
    },
    getState: () => state,
    location,
  });
  return { actions, storage, getEvent, dispatched, location, state: () => state };
}

describe('openPoll', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness('#admin=tok-from-hash');
    h.getEvent.mockResolvedValue(event({ viewer: { isAdmin: true } }));
  });

  it('moves the admin token from the fragment into storage before anything else', async () => {
    await h.actions.openPoll('ev1');
    expect(h.storage.getAdminToken('ev1')).toBe('tok-from-hash');
    expect(h.location.clearHash).toHaveBeenCalledOnce();
    expect(h.dispatched[0]).toEqual({ type: 'poll/open', id: 'ev1', adminToken: 'tok-from-hash', me: null });
  });

  it('fetches with that token and reports the loaded event', async () => {
    await h.actions.openPoll('ev1');
    expect(h.getEvent).toHaveBeenCalledWith('ev1', 'tok-from-hash');
    expect(h.dispatched[1]).toMatchObject({ type: 'poll/loaded', id: 'ev1' });
    expect(h.state().poll?.event?.title).toBe('Dinner');
  });

  it('falls back to the stored token and identity when the fragment has none', async () => {
    const plain = harness();
    plain.storage.setAdminToken('ev1', 'stored-tok');
    plain.storage.setParticipant('ev1', me);
    plain.getEvent.mockResolvedValue(event());
    await plain.actions.openPoll('ev1');
    expect(plain.dispatched[0]).toEqual({ type: 'poll/open', id: 'ev1', adminToken: 'stored-tok', me });
    expect(plain.location.clearHash).not.toHaveBeenCalled();
  });

  it('reports a failed load with the user-facing message', async () => {
    h.getEvent.mockRejectedValue(new ApiRequestError(404, 'not_found', 'Not found'));
    await h.actions.openPoll('ev1');
    expect(h.dispatched[1]).toEqual({
      type: 'poll/failed',
      id: 'ev1',
      error: 'This poll does not exist or was deleted.',
    });
  });
});

describe('refresh', () => {
  it('re-fetches the current poll with its effective admin token', async () => {
    const h = harness();
    h.storage.setAdminToken('ev1', 'stored-tok');
    h.getEvent.mockResolvedValue(event({ viewer: { isAdmin: true } }));
    await h.actions.openPoll('ev1');
    await h.actions.refresh();
    expect(h.getEvent).toHaveBeenLastCalledWith('ev1', 'stored-tok');
    expect(h.dispatched.at(-1)).toMatchObject({ type: 'poll/loaded', id: 'ev1' });
  });

  it('forgets a stored identity the poll no longer lists, and keeps one it does', async () => {
    const h = harness();
    h.storage.setParticipant('ev1', me);
    h.getEvent.mockResolvedValue(event());
    await h.actions.openPoll('ev1');
    await h.actions.refresh();
    expect(h.storage.getParticipant('ev1')).toEqual(me);

    h.getEvent.mockResolvedValue(event({ participants: [] }));
    await h.actions.refresh();
    expect(h.storage.getParticipant('ev1')).toBeNull();
    expect(h.state().poll?.me).toBeNull();
  });

  it('does nothing when no poll is open', async () => {
    const h = harness();
    await h.actions.refresh();
    expect(h.getEvent).not.toHaveBeenCalled();
    expect(h.dispatched).toEqual([]);
  });
});

describe('setIdentity and forgetPoll', () => {
  it('writes the identity through to storage and state, and removes it on null', async () => {
    const h = harness();
    h.getEvent.mockResolvedValue(event());
    await h.actions.openPoll('ev1');
    h.actions.setIdentity(me);
    expect(h.storage.getParticipant('ev1')).toEqual(me);
    expect(h.state().poll?.me).toEqual(me);
    h.actions.setIdentity(null);
    expect(h.storage.getParticipant('ev1')).toBeNull();
    expect(h.dispatched.at(-1)).toEqual({ type: 'poll/identity', me: null });
  });

  it('clears both tokens for the poll and closes the session', async () => {
    const h = harness('#admin=tok');
    h.storage.setParticipant('ev1', me);
    h.getEvent.mockResolvedValue(event({ viewer: { isAdmin: true } }));
    await h.actions.openPoll('ev1');
    h.actions.forgetPoll();
    expect(h.storage.getAdminToken('ev1')).toBeNull();
    expect(h.storage.getParticipant('ev1')).toBeNull();
    expect(h.state()).toEqual({ poll: null });
  });
});
