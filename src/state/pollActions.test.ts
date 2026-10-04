import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventView } from '@shared/types';
import { ApiRequestError } from '../lib/api';
import { participantHash } from '../lib/participantLink';
import type { ParticipantIdentity } from '../lib/storage';
import { appReducer, initialAppState, type AppAction, type AppState } from './app';
import { browserLocation, createPollActions, type PollActionDeps, type PollActions } from './pollActions';

const me: ParticipantIdentity = { id: 'p'.repeat(22), token: 't'.repeat(43) };
const meA: ParticipantIdentity = { id: 'a'.repeat(22), token: 'a'.repeat(43) };
const meB: ParticipantIdentity = { id: 'b'.repeat(22), token: 'b'.repeat(43) };
const bea = { id: meB.id, name: 'Bea', votes: {}, createdAt: 0, isOrganiser: false };

const event = (overrides: Partial<EventView> = {}): EventView => ({
  id: 'ev1',
  title: 'Dinner',
  description: '',
  allowSuggestions: true,
  createdAt: 0,
  expiresAt: 1,
  options: [],
  participants: [{ id: me.id, name: 'Ada', votes: {}, createdAt: 0, isOrganiser: false }],
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
  const verifyParticipant = vi.fn<PollActionDeps['api']['verifyParticipant']>().mockResolvedValue(undefined);
  const dispatched: AppAction[] = [];
  const queue: AppAction[] = [];
  const apply = (action: AppAction) => {
    dispatched.push(action);
    state = appReducer(state, action);
  };
  const location = {
    readHash: vi.fn(() => hash),
    replaceHash: vi.fn((_id: string, value: string) => void (hash = value)),
  };
  const actions: PollActions = createPollActions({
    api: { getEvent, verifyParticipant },
    storage,
    dispatch: (action) => (deferred ? queue.push(action) : apply(action)),
    getState: () => state,
    location,
  });
  const flush = () => queue.splice(0).forEach(apply);
  return { actions, storage, getEvent, verifyParticipant, dispatched, location, flush, state: () => state };
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
    expect(h.location.replaceHash).toHaveBeenCalledExactlyOnceWith('ev1', '');
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
    expect(plain.location.replaceHash).toHaveBeenCalledExactlyOnceWith('ev1', participantHash(me));
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

describe('private participant links', () => {
  it('restores and verifies an identity in a fresh browser, retaining the fragment for recovery', async () => {
    const h = harness(participantHash(me));
    h.getEvent.mockResolvedValue(event());
    await h.actions.openPoll('ev1');
    expect(h.verifyParticipant).toHaveBeenCalledExactlyOnceWith('ev1', me, expect.any(AbortSignal));
    expect(h.state().poll?.me).toEqual(me);
    expect(h.storage.getParticipant('ev1')).toEqual(me);
    expect(h.location.readHash()).toBe(participantHash(me));
    expect(h.location.replaceHash).not.toHaveBeenCalled();
  });

  it('migrates an existing localStorage identity without rotating its edit token', async () => {
    const h = harness();
    h.storage.setParticipant('ev1', me);
    h.getEvent.mockResolvedValue(event());
    await h.actions.openPoll('ev1');
    expect(h.verifyParticipant).toHaveBeenCalledWith('ev1', me, expect.any(AbortSignal));
    expect(h.location.readHash()).toBe(participantHash(me));
    expect(h.state().poll?.me).toEqual(me);
  });

  it('prefers an explicit link to a different stored identity for the same poll', async () => {
    const h = harness(participantHash(me));
    h.storage.setParticipant('ev1', meB);
    h.getEvent.mockResolvedValue(event({ participants: [...event().participants, bea] }));
    await h.actions.openPoll('ev1');
    expect(h.state().poll?.me).toEqual(me);
    expect(h.storage.getParticipant('ev1')).toEqual(me);
    expect(h.verifyParticipant).toHaveBeenCalledWith('ev1', me, expect.any(AbortSignal));
  });

  it('retains private-link access when storage is blocked and the opening effect runs twice', async () => {
    const h = harness(participantHash(me), blockedStorage(), { deferred: true });
    h.getEvent.mockResolvedValue(event());
    const first = h.actions.openPoll('ev1');
    const second = h.actions.openPoll('ev1');
    h.flush();
    await Promise.all([first, second]);
    h.flush();
    expect(h.state().poll?.me).toEqual(me);
    expect(h.location.readHash()).toBe(participantHash(me));
    expect(h.storage.getParticipant('ev1')).toBeNull();
  });

  it.each([
    `#admin=admin-token&participant=${me.id}&token=${me.token}`,
    `#participant=${me.id}&admin=admin-token&token=${me.token}`,
    `#participant=${me.id}&token=${me.token}&admin=admin-token`,
  ])('keeps both credentials in a combined private link', async (hash) => {
    const h = harness(hash);
    h.getEvent.mockResolvedValue(event({ viewer: { isAdmin: true } }));
    await h.actions.openPoll('ev1');
    expect(h.state().poll?.adminToken).toBe('admin-token');
    expect(h.state().poll?.me).toEqual(me);
    expect(h.verifyParticipant).toHaveBeenCalledWith('ev1', me, expect.any(AbortSignal));
    expect(h.location.readHash()).toBe(`${participantHash(me)}&admin=admin-token`);
  });

  it('gives an organiser a private link that restores both roles in a fresh browser', async () => {
    const h = harness('#admin=admin-token');
    h.getEvent.mockResolvedValue(event({ viewer: { isAdmin: true } }));
    await h.actions.openPoll('ev1');
    h.actions.setIdentity('ev1', me);
    const hash = h.location.readHash();
    expect(hash).toBe(`${participantHash(me)}&admin=admin-token`);

    const otherDevice = harness(hash, blockedStorage());
    otherDevice.getEvent.mockResolvedValue(event({ viewer: { isAdmin: true } }));
    await otherDevice.actions.openPoll('ev1');
    await otherDevice.actions.openPoll('ev1');
    expect(otherDevice.getEvent).toHaveBeenLastCalledWith('ev1', 'admin-token', expect.any(AbortSignal));
    expect(otherDevice.state().poll?.adminToken).toBe('admin-token');
    expect(otherDevice.state().poll?.me).toEqual(me);
    expect(otherDevice.location.readHash()).toBe(hash);
  });

  it('upgrades an organiser private link using the saved admin token', async () => {
    const h = harness(participantHash(me));
    h.storage.setAdminToken('ev1', 'admin-token');
    h.getEvent.mockResolvedValue(event({ viewer: { isAdmin: true } }));
    await h.actions.openPoll('ev1');
    expect(h.location.readHash()).toBe(`${participantHash(me)}&admin=admin-token`);
  });

  it('removes a rejected admin token from the private link without losing participant access', async () => {
    const h = harness(`${participantHash(me)}&admin=wrong-token`);
    h.getEvent.mockResolvedValue(event());
    await h.actions.openPoll('ev1');
    expect(h.state().poll?.adminToken).toBeNull();
    expect(h.state().poll?.me).toEqual(me);
    expect(h.location.readHash()).toBe(participantHash(me));
  });

  it('keeps organiser recovery in the URL when the participant identity is removed', async () => {
    const h = harness(`${participantHash(me)}&admin=admin-token`);
    h.getEvent.mockResolvedValue(event({ viewer: { isAdmin: true } }));
    await h.actions.openPoll('ev1');
    h.actions.setIdentity('ev1', null);
    expect(h.state().poll?.adminToken).toBe('admin-token');
    expect(h.location.readHash()).toBe('#admin=admin-token');
  });

  it('checks the participant token even when the browser already has organiser access', async () => {
    const h = harness(participantHash(me));
    h.storage.setAdminToken('ev1', 'admin-token');
    h.getEvent.mockResolvedValue(event({ viewer: { isAdmin: true } }));
    h.verifyParticipant.mockRejectedValue(new ApiRequestError(403, 'not_owner', 'Invalid link'));
    await h.actions.openPoll('ev1');
    expect(h.state().poll?.adminToken).toBe('admin-token');
    expect(h.state().poll?.me).toBeNull();
    expect(h.location.readHash()).toBe('#admin=admin-token');
  });

  it('rejects a tampered link without adopting or erasing another stored identity', async () => {
    const h = harness(participantHash(me));
    h.storage.setParticipant('ev1', meB);
    h.getEvent.mockResolvedValue(event({ participants: [...event().participants, bea] }));
    h.verifyParticipant.mockRejectedValue(new ApiRequestError(403, 'not_owner', 'Invalid link'));
    await h.actions.openPoll('ev1');
    expect(h.state().poll?.me).toBeNull();
    expect(h.storage.getParticipant('ev1')).toEqual(meB);
    expect(h.location.readHash()).toBe('');
  });

  it('does not fall back to a stored identity for a malformed explicit link', async () => {
    const h = harness('#participant=short&token=short');
    h.storage.setParticipant('ev1', me);
    h.getEvent.mockResolvedValue(event());
    await h.actions.openPoll('ev1');
    expect(h.state().poll?.me).toBeNull();
    expect(h.verifyParticipant).not.toHaveBeenCalled();
    expect(h.storage.getParticipant('ev1')).toEqual(me);
    expect(h.location.readHash()).toBe('');
  });

  it('removes an invalid stored token even if its participant still exists', async () => {
    const h = harness();
    h.storage.setParticipant('ev1', me);
    h.getEvent.mockResolvedValue(event());
    h.verifyParticipant.mockRejectedValue(new ApiRequestError(403, 'not_owner', 'Invalid link'));
    await h.actions.openPoll('ev1');
    expect(h.state().poll?.me).toBeNull();
    expect(h.storage.getParticipant('ev1')).toBeNull();
    expect(h.location.readHash()).toBe('');
  });

  it('clears a deleted participant from the fragment, memory and storage', async () => {
    const h = harness(participantHash(me));
    h.getEvent.mockResolvedValue(event());
    await h.actions.openPoll('ev1');
    h.getEvent.mockResolvedValue(event({ participants: [] }));
    h.verifyParticipant.mockRejectedValue(new ApiRequestError(403, 'not_owner', 'Invalid link'));
    await h.actions.refresh('ev1');
    expect(h.state().poll?.me).toBeNull();
    expect(h.storage.getParticipant('ev1')).toBeNull();
    expect(h.location.readHash()).toBe('');
    // A later visit cannot recover the removed identity from the actions' in-memory copy.
    await h.actions.openPoll('ev1');
    expect(h.dispatched.filter((a) => a.type === 'poll/open').at(-1)).toMatchObject({ me: null });
  });

  it('keeps the private link and credentials through a verification outage and recovers on retry', async () => {
    const h = harness(participantHash(me));
    h.getEvent.mockResolvedValue(event());
    h.verifyParticipant.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await h.actions.openPoll('ev1');
    expect(h.state().poll?.error?.gone).toBe(false);
    expect(h.state().poll?.event).toBeNull();
    expect(h.location.readHash()).toBe(participantHash(me));
    expect(h.storage.getParticipant('ev1')).toBeNull();
    await expect(h.actions.refresh('ev1')).resolves.toBe(true);
    expect(h.state().poll?.me).toEqual(me);
    expect(h.storage.getParticipant('ev1')).toEqual(me);
  });

  it('does not rewrite the current URL or storage when verification completes after navigation', async () => {
    const h = harness(participantHash(me));
    const verification = deferred<void>();
    h.getEvent.mockResolvedValueOnce(event());
    h.verifyParticipant.mockReturnValueOnce(verification.promise);
    const open = h.actions.openPoll('ev1');
    h.location.replaceHash('ev1', '');
    h.getEvent.mockResolvedValueOnce(event({ id: 'B', participants: [] }));
    await h.actions.openPoll('B');
    verification.resolve();
    await open;
    expect(h.state().poll?.id).toBe('B');
    expect(h.location.readHash()).toBe('');
    expect(h.storage.getParticipant('ev1')).toBeNull();
  });

  it.each(['success', 'failure'])(
    'ignores an old %s after a new private link opens before the navigation effect',
    async (result) => {
      const h = harness();
      h.storage.setParticipant('ev1', me);
      const pending = deferred<EventView>();
      h.getEvent.mockReturnValueOnce(pending.promise);
      const firstOpen = h.actions.openPoll('ev1');
      // Browser navigation changes the fragment before React's effect starts the next openPoll.
      h.location.replaceHash('ev1', participantHash(meB));
      if (result === 'success') pending.resolve(event());
      else pending.reject(new TypeError('Failed to fetch'));
      await firstOpen;
      expect(h.location.readHash()).toBe(participantHash(meB));
      expect(h.state().poll?.error).toBeNull();
      h.getEvent.mockResolvedValueOnce(event({ participants: [...event().participants, bea] }));
      await h.actions.openPoll('ev1');
      expect(h.state().poll?.me).toEqual(meB);
      expect(h.storage.getParticipant('ev1')).toEqual(meB);
    },
  );

  it('ignores an old refresh if the identity changes while it is in flight', async () => {
    const h = harness();
    h.getEvent.mockResolvedValueOnce(event());
    await h.actions.openPoll('ev1');
    const pending = deferred<EventView>();
    h.getEvent.mockReturnValueOnce(pending.promise);
    const refresh = h.actions.refresh('ev1');
    h.actions.setIdentity('ev1', me);
    pending.resolve(event({ participants: [] }));
    await expect(refresh).resolves.toBe(false);
    expect(h.state().poll?.me).toEqual(me);
    expect(h.location.readHash()).toBe(participantHash(me));
  });

  it('changes the fragment on joining or leaving and leaves it alone for another poll', async () => {
    const h = harness();
    h.getEvent.mockResolvedValue(event());
    await h.actions.openPoll('ev1');
    h.actions.setIdentity('other', meB);
    expect(h.location.readHash()).toBe('');
    h.actions.setIdentity('ev1', me);
    expect(h.location.readHash()).toBe(participantHash(me));
    h.actions.setIdentity('ev1', null);
    expect(h.location.readHash()).toBe('');
    h.actions.setIdentity('ev1', me);
    h.actions.forgetPoll('ev1');
    expect(h.location.readHash()).toBe('');
  });
});

describe('browserLocation', () => {
  it('replaces only the fragment, preserving the query string and router history state', () => {
    const replaceState = vi.fn();
    const state = { idx: 2, key: 'router-key', usr: null };
    vi.stubGlobal('window', {
      location: { hash: '#old', pathname: '/e/poll', search: '?source=invite' },
      history: { state, replaceState },
    });
    expect(browserLocation.readHash()).toBe('#old');
    browserLocation.replaceHash('poll', participantHash(me));
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(state, '', `/e/poll?source=invite${participantHash(me)}`);
  });

  it.each(['/', '/e/another', '/nothing/here'])('does not attach a late private link to %s', (pathname) => {
    const replaceState = vi.fn();
    vi.stubGlobal('window', { location: { pathname }, history: { replaceState } });
    browserLocation.replaceHash('poll', participantHash(me));
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('also replaces a fragment on a poll route with a trailing slash', () => {
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      location: { pathname: '/e/poll/', search: '' },
      history: { state: null, replaceState },
    });
    browserLocation.replaceHash('poll', participantHash(me));
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, '', `/e/poll/${participantHash(me)}`);
  });
});
