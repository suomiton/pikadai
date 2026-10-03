import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventView } from '@shared/types';
import { ApiRequestError } from '../lib/api';
import type { ParticipantIdentity } from '../lib/storage';
import { appReducer, initialAppState, type AppAction, type AppState } from './app';
import { createPollActions, type PollActionDeps, type PollActions } from './pollActions';

const me: ParticipantIdentity = { id: 'p1', token: 'tok-p1' };
const meA: ParticipantIdentity = { id: 'pa', token: 'tok-a' };
const meB: ParticipantIdentity = { id: 'pb', token: 'tok-b' };
const bea = { id: 'pb', nickname: 'Bea', votes: {}, createdAt: 0 };

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
  viewer: { isAdmin: false },
  ...overrides,
});

type Storage = PollActionDeps['storage'];

/** A Map-backed stand-in for localStorage access, keyed the way the real module keys it. */
function fakeStorage() {
  const admin = new Map<string, string>();
  const participants = new Map<string, ParticipantIdentity>();
  const storage: Storage = {
    available: () => true,
    getAdminToken: (id) => admin.get(id) ?? null,
    setAdminToken: (id, token) => void (token === null ? admin.delete(id) : admin.set(id, token)),
    getParticipant: (id) => participants.get(id) ?? null,
    setParticipant: (id, identity) =>
      void (identity === null ? participants.delete(id) : participants.set(id, identity)),
  };
  return storage;
}

/** A browser that refuses site data: every write is lost and every read comes back empty. */
function blockedStorage(): Storage {
  return {
    available: () => false,
    getAdminToken: () => null,
    setAdminToken: () => undefined,
    getParticipant: () => null,
    setParticipant: () => undefined,
  };
}

/** A fetch the test resolves or rejects by hand, to control the order responses arrive in. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * The actions under test with every dependency faked. Dispatched actions are run through the real
 * reducer so `getState` returns what the provider would hold after each one. With `deferred`, they
 * queue until `flush()`, the way React commits a dispatch only after the current effects have run.
 */
function harness(hash = '', storage: Storage = fakeStorage(), { deferred = false } = {}) {
  let state: AppState = initialAppState;
  const getEvent = vi.fn<PollActionDeps['api']['getEvent']>();
  const dispatched: AppAction[] = [];
  const queue: AppAction[] = [];
  const apply = (action: AppAction) => {
    dispatched.push(action);
    state = appReducer(state, action);
  };
  const location = { readHash: vi.fn(() => hash), clearHash: vi.fn(() => void (hash = '')) };
  const actions: PollActions = createPollActions({
    api: { getEvent },
    storage,
    dispatch: (action) => (deferred ? queue.push(action) : apply(action)),
    getState: () => state,
    location,
  });
  const flush = () => queue.splice(0).forEach(apply);
  return { actions, storage, getEvent, dispatched, location, flush, state: () => state };
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
    expect(h.getEvent).toHaveBeenCalledWith('ev1', 'tok-from-hash', expect.any(AbortSignal));
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

  it('reports a failed load with the user-facing message, marking a missing poll as gone', async () => {
    h.getEvent.mockRejectedValue(new ApiRequestError(404, 'not_found', 'Not found'));
    await h.actions.openPoll('ev1');
    expect(h.dispatched[1]).toEqual({
      type: 'poll/failed',
      id: 'ev1',
      error: { message: 'This poll does not exist or was deleted.', gone: true },
    });
  });

  it('treats an expired poll as gone and anything else as transient', async () => {
    h.getEvent.mockRejectedValueOnce(new ApiRequestError(410, 'expired', 'Gone'));
    await h.actions.openPoll('ev1');
    expect(h.state().poll?.error).toEqual({ message: 'This poll has expired and was deleted.', gone: true });

    h.getEvent.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await h.actions.openPoll('ev1');
    expect(h.state().poll?.error).toEqual({
      message: 'Network error. Check your connection and try again.',
      gone: false,
    });

    h.getEvent.mockRejectedValueOnce(new ApiRequestError(429, 'rate_limited', 'Slow down'));
    await h.actions.openPoll('ev1');
    expect(h.state().poll?.error?.gone).toBe(false);
  });
});

describe('refresh', () => {
  it('re-fetches the poll on screen with its effective admin token and resolves true', async () => {
    const h = harness();
    h.storage.setAdminToken('ev1', 'stored-tok');
    h.getEvent.mockResolvedValue(event({ viewer: { isAdmin: true } }));
    await h.actions.openPoll('ev1');
    await expect(h.actions.refresh('ev1')).resolves.toBe(true);
    expect(h.getEvent).toHaveBeenLastCalledWith('ev1', 'stored-tok', expect.any(AbortSignal));
    expect(h.dispatched.at(-1)).toMatchObject({ type: 'poll/loaded', id: 'ev1' });
  });

  it('forgets a stored identity the poll no longer lists, and keeps one it does', async () => {
    const h = harness();
    h.storage.setParticipant('ev1', me);
    h.getEvent.mockResolvedValue(event());
    await h.actions.openPoll('ev1');
    await h.actions.refresh('ev1');
    expect(h.storage.getParticipant('ev1')).toEqual(me);

    h.getEvent.mockResolvedValue(event({ participants: [] }));
    await h.actions.refresh('ev1');
    expect(h.storage.getParticipant('ev1')).toBeNull();
    expect(h.state().poll?.me).toBeNull();
  });

  it('does nothing when no poll is open or another poll is on screen', async () => {
    const h = harness();
    await expect(h.actions.refresh('ev1')).resolves.toBe(false);
    expect(h.getEvent).not.toHaveBeenCalled();

    h.getEvent.mockResolvedValue(event({ id: 'ev2' }));
    await h.actions.openPoll('ev2');
    h.getEvent.mockClear();
    await expect(h.actions.refresh('ev1')).resolves.toBe(false);
    expect(h.getEvent).not.toHaveBeenCalled();
  });

  it('keeps the loaded event when the refresh fails and resolves false', async () => {
    const h = harness();
    h.getEvent.mockResolvedValueOnce(event());
    await h.actions.openPoll('ev1');
    h.getEvent.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(h.actions.refresh('ev1')).resolves.toBe(false);
    expect(h.state().poll?.event?.title).toBe('Dinner');
    expect(h.state().poll?.error?.gone).toBe(false);
  });

  it('applies results in request order even when the responses arrive reversed', async () => {
    const h = harness();
    h.getEvent.mockResolvedValueOnce(event({ participants: [] }));
    await h.actions.openPoll('ev1');

    const older = deferred<EventView>();
    const newer = deferred<EventView>();
    h.getEvent.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const olderRefresh = h.actions.refresh('ev1');
    // The participant was created between the two requests, so only the newer response lists them.
    h.actions.setIdentity('ev1', me);
    const newerRefresh = h.actions.refresh('ev1');

    newer.resolve(event());
    await expect(newerRefresh).resolves.toBe(true);
    older.resolve(event({ participants: [] }));
    await expect(olderRefresh).resolves.toBe(false);

    expect(h.state().poll?.event?.participants).toHaveLength(1);
    expect(h.state().poll?.me).toEqual(me);
    expect(h.storage.getParticipant('ev1')).toEqual(me);
  });

  it('aborts the request a newer one supersedes and reports nothing for it', async () => {
    const h = harness();
    h.getEvent.mockResolvedValueOnce(event());
    await h.actions.openPoll('ev1');

    const signals: AbortSignal[] = [];
    const older = deferred<EventView>();
    h.getEvent.mockImplementationOnce((_id, _token, signal) => {
      signals.push(signal!);
      return older.promise;
    });
    h.getEvent.mockResolvedValueOnce(event({ title: 'Lunch' }));
    const olderRefresh = h.actions.refresh('ev1');
    await h.actions.refresh('ev1');
    expect(signals[0].aborted).toBe(true);

    const before = h.dispatched.length;
    older.reject(new DOMException('aborted', 'AbortError'));
    await expect(olderRefresh).resolves.toBe(false);
    expect(h.dispatched).toHaveLength(before);
    expect(h.state().poll?.event?.title).toBe('Lunch');
    expect(h.state().poll?.error).toBeNull();
  });
});

describe('setIdentity and forgetPoll', () => {
  it('writes the identity through to storage and state, and removes it on null', async () => {
    const h = harness();
    h.getEvent.mockResolvedValue(event());
    await h.actions.openPoll('ev1');
    h.actions.setIdentity('ev1', me);
    expect(h.storage.getParticipant('ev1')).toEqual(me);
    expect(h.state().poll?.me).toEqual(me);
    h.actions.setIdentity('ev1', null);
    expect(h.storage.getParticipant('ev1')).toBeNull();
    expect(h.dispatched.at(-1)).toEqual({ type: 'poll/identity', id: 'ev1', me: null });
  });

  it('stores a late identity under the poll it belongs to, not the one now on screen', async () => {
    const h = harness();
    h.storage.setParticipant('B', meB);
    h.getEvent.mockResolvedValueOnce(event({ id: 'A', participants: [] }));
    await h.actions.openPoll('A');
    h.getEvent.mockResolvedValueOnce(event({ id: 'B', participants: [bea] }));
    await h.actions.openPoll('B');

    // A's answer request completed after the user had moved on to B.
    h.actions.setIdentity('A', meA);
    expect(h.storage.getParticipant('A')).toEqual(meA);
    expect(h.storage.getParticipant('B')).toEqual(meB);
    expect(h.state().poll?.id).toBe('B');
    expect(h.state().poll?.me).toEqual(meB);
    expect(h.dispatched.filter((a) => a.type === 'poll/identity')).toEqual([]);
  });

  it('clears both tokens for the poll and closes the session', async () => {
    const h = harness('#admin=tok');
    h.storage.setParticipant('ev1', me);
    h.getEvent.mockResolvedValue(event({ viewer: { isAdmin: true } }));
    await h.actions.openPoll('ev1');
    h.actions.forgetPoll('ev1');
    expect(h.storage.getAdminToken('ev1')).toBeNull();
    expect(h.storage.getParticipant('ev1')).toBeNull();
    expect(h.state()).toEqual({ poll: null });
  });

  it('forgets a poll that is no longer on screen without closing the current one', async () => {
    const h = harness();
    h.storage.setAdminToken('A', 'tok-a');
    h.storage.setParticipant('B', meB);
    h.getEvent.mockResolvedValueOnce(event({ id: 'A', participants: [] }));
    await h.actions.openPoll('A');
    h.getEvent.mockResolvedValueOnce(event({ id: 'B', participants: [bea] }));
    await h.actions.openPoll('B');

    h.actions.forgetPoll('A'); // A's delete request completed after the navigation
    expect(h.storage.getAdminToken('A')).toBeNull();
    expect(h.storage.getParticipant('B')).toEqual(meB);
    expect(h.state().poll?.id).toBe('B');
    expect(h.state().poll?.event?.id).toBe('B');
  });
});

describe('openPoll under real-world timing', () => {
  it('keeps the admin token when the opening effect runs twice, as StrictMode does in development', async () => {
    const h = harness('#admin=tok-from-hash');
    h.getEvent.mockResolvedValue(event({ viewer: { isAdmin: true } }));
    // The first run strips the hash; the second finds nothing there and must fall back to storage.
    await h.actions.openPoll('ev1');
    await h.actions.openPoll('ev1');
    const opens = h.dispatched.filter((a) => a.type === 'poll/open');
    expect(opens).toHaveLength(2);
    expect(opens.map((a) => a.type === 'poll/open' && a.adminToken)).toEqual(['tok-from-hash', 'tok-from-hash']);
    expect(h.state().poll?.adminToken).toBe('tok-from-hash');
  });

  it('keeps the credentials it handed over when storage is blocked and the effect runs twice', async () => {
    // React commits the first run's dispatch only after both runs of the effect have executed.
    const h = harness('#admin=tok-from-hash', blockedStorage(), { deferred: true });
    h.getEvent.mockResolvedValue(event({ viewer: { isAdmin: true } }));
    // The first run strips the hash and its write to storage is lost; the second finds neither.
    const first = h.actions.openPoll('ev1');
    const second = h.actions.openPoll('ev1');
    h.flush();
    await Promise.all([first, second]);
    h.flush();
    expect(h.getEvent).toHaveBeenNthCalledWith(2, 'ev1', 'tok-from-hash', expect.any(AbortSignal));
    expect(h.state().poll?.adminToken).toBe('tok-from-hash');
    expect(h.state().poll?.event?.viewer.isAdmin).toBe(true);

    h.actions.setIdentity('ev1', me);
    h.flush();
    await h.actions.openPoll('ev1');
    h.flush();
    expect(h.state().poll?.me).toEqual(me);
  });

  it('ignores a late response for a poll the user has left and leaves that poll’s stored identity alone', async () => {
    const h = harness();
    h.storage.setParticipant('A', meA);
    h.storage.setParticipant('B', meB);

    const a = deferred<EventView>();
    h.getEvent.mockReturnValueOnce(a.promise);
    h.getEvent.mockResolvedValueOnce(event({ id: 'B', participants: [bea] }));

    const openA = h.actions.openPoll('A');
    await h.actions.openPoll('B');
    // A's event does not list B's participant; without the id guard this would clear B's identity.
    a.resolve(event({ id: 'A', participants: [] }));
    await openA;

    expect(h.state().poll?.id).toBe('B');
    expect(h.state().poll?.event?.id).toBe('B');
    expect(h.state().poll?.me).toEqual(meB);
    expect(h.storage.getParticipant('A')).toEqual(meA);
    expect(h.storage.getParticipant('B')).toEqual(meB);
  });

  it('discards the first load when the user leaves and returns before it finishes', async () => {
    const h = harness();
    const first = deferred<EventView>();
    h.getEvent.mockReturnValueOnce(first.promise);
    h.getEvent.mockResolvedValueOnce(event({ id: 'B' }));
    h.getEvent.mockResolvedValueOnce(event({ title: 'Current' }));

    const openFirst = h.actions.openPoll('ev1');
    await h.actions.openPoll('B');
    await h.actions.openPoll('ev1');
    first.resolve(event({ title: 'Stale' }));
    await openFirst;

    expect(h.state().poll?.event?.title).toBe('Current');
  });
});
