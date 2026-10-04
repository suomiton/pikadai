import type { EventView } from '@shared/types';
import { ApiRequestError, type api as apiModule } from '../lib/api';
import { describeError } from '../lib/errors';
import { hasParticipantHash, parseParticipantHash } from '../lib/participantLink';
import type { ParticipantIdentity, storage as storageModule } from '../lib/storage';
import { hasParticipant, parseAdminHash, type AppAction, type AppState } from './app';

/**
 * The side effects around the poll session: fetching, reading and writing the tokens in
 * localStorage, and private-link fragments. Every dependency is injected so the module runs under
 * Node with fakes; the provider wires in the real ones.
 */
export interface PollActionDeps {
  api: Pick<typeof apiModule, 'getEvent' | 'verifyParticipant'>;
  storage: typeof storageModule;
  dispatch: (action: AppAction) => void;
  getState: () => AppState;
  location: { readHash(): string; replaceHash(id: string, hash: string): string | void };
}

/**
 * Every action names the poll it is about. A mutation's callback runs when the request finishes,
 * which can be after the user has moved on to another poll; its credentials must still land under
 * the poll they belong to, and the poll now on screen must be left alone.
 */
export interface PollActions {
  /** Start viewing a poll: pick up private-link or stored credentials, validate the identity, then fetch. */
  openPoll(id: string, navigationKey?: string, routerHash?: string): Promise<void>;
  /** Re-fetch poll `id` if it is the one on screen. Resolves to whether the fetch succeeded. */
  refresh(id: string): Promise<boolean>;
  /** Remember (or forget, with null) which participant this browser is in poll `id`. */
  setIdentity(id: string, me: ParticipantIdentity | null): void;
  /** Drop every token for poll `id` and close its session if it is on screen; used after the organiser deletes it. */
  forgetPoll(id: string): void;
  /** Show poll `id` without joining ("Just take me to results"), or go back to the Name tile. */
  setResultsOnly(id: string, value: boolean): void;
}

/** The server says the poll no longer exists: deleted (404) or expired (410). */
const isGone = (err: unknown): boolean => {
  return err instanceof ApiRequestError && (err.status === 404 || err.status === 410);
};

const sameIdentity = (a: ParticipantIdentity | null, b: ParticipantIdentity | null): boolean => {
  return a?.id === b?.id && a?.token === b?.token;
};

type Verification = { status: 'valid' | 'invalid' } | { status: 'pending'; message: string };
const invalidLinkNotice = 'This private link is no longer valid.';
const savedProfileNotice =
  'This browser already has a saved name for this poll. The other private link was not opened.';

/** In-memory credentials survive blocked storage and StrictMode's repeated opening effect. */
interface CapturedPoll {
  id: string;
  navigationKey: string | undefined;
  adminToken: string | null;
  me: ParticipantIdentity | null;
  verified: boolean;
  saved: ParticipantIdentity | null;
  fromLink: boolean;
  notice: string | null;
}

/** Number and abort requests so a stale response cannot replace a newer session. */
interface RequestState {
  issued: number;
  applied: number;
  inFlight: AbortController | null;
  held: CapturedPoll | null;
}

interface ResolvedIdentity {
  candidate: ParticipantIdentity | null;
  verification: Verification;
  notice: string | null;
  rejected: ParticipantIdentity[];
}

const replaceHash = (location: PollActionDeps['location'], id: string, hash: string) => {
  if (location.readHash() !== hash) return location.replaceHash(id, hash);
};

const validIdentity = async (
  api: PollActionDeps['api'],
  id: string,
  me: ParticipantIdentity,
  signal: AbortSignal,
): Promise<Verification> => {
  try {
    await api.verifyParticipant(id, me, signal);
    return { status: 'valid' };
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 403 && err.code === 'not_owner') return { status: 'invalid' };
    // Keep the poll readable and the candidate in memory; only identity-dependent actions wait.
    return { status: 'pending', message: describeError(err) };
  }
};

const resolveIdentity = async (
  { api, storage }: PollActionDeps,
  session: CapturedPoll,
  event: EventView,
  initialVerification: Verification,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<ResolvedIdentity | null> => {
  const { id } = session;
  let candidate = session.me;
  let verification = initialVerification;
  let notice = session.notice;
  // Another tab may have saved this browser's profile while the link was being checked.
  // Confirm that profile instead of exposing the linked person's answers as editable.
  const savedDuringLoad = storage.getParticipant(id);
  if (session.fromLink && candidate && savedDuringLoad && candidate.id !== savedDuringLoad.id) {
    candidate = savedDuringLoad;
    notice = savedProfileNotice;
    verification = hasParticipant(event, candidate)
      ? await validIdentity(api, id, candidate, signal)
      : { status: 'invalid' };
    if (!isCurrent()) return null;
  }
  const rejected: ParticipantIdentity[] = [];
  if (candidate && (!hasParticipant(event, candidate) || verification.status === 'invalid')) {
    rejected.push(candidate);
    candidate = session.fromLink && !sameIdentity(candidate, session.saved) ? session.saved : null;
    if (session.fromLink && notice !== savedProfileNotice) notice = invalidLinkNotice;
    verification =
      candidate && hasParticipant(event, candidate)
        ? await validIdentity(api, id, candidate, signal)
        : { status: 'invalid' };
    if (!isCurrent()) return null;
  }
  if (candidate && verification.status === 'invalid') {
    rejected.push(candidate);
    candidate = null;
  }
  return { candidate, verification, notice, rejected };
};

const rememberCredentials = (
  storage: PollActionDeps['storage'],
  session: CapturedPoll,
  event: EventView,
  adminToken: string | null,
  { candidate, verification, notice, rejected }: ResolvedIdentity,
) => {
  const { id } = session;
  for (const identity of rejected) {
    if (sameIdentity(storage.getParticipant(id), identity)) storage.setParticipant(id, null);
  }
  let effective = verification.status === 'valid' ? candidate : null;
  const saved = storage.getParticipant(id);
  if (effective && saved && saved.id !== effective.id) {
    candidate = saved;
    effective = null;
    notice = savedProfileNotice;
    verification = {
      status: 'pending',
      message: 'Your saved name changed while this link was opening. Try again to confirm it.',
    };
  }
  if (effective) storage.setParticipant(id, effective);
  const effectiveAdmin = event.viewer.isAdmin ? adminToken : null;
  if (effectiveAdmin) storage.setAdminToken(id, effectiveAdmin);
  else if (adminToken && storage.getAdminToken(id) === adminToken) storage.setAdminToken(id, null);
  return {
    held: {
      ...session,
      adminToken: effectiveAdmin,
      me: candidate,
      verified: verification.status === 'valid',
      saved: storage.getParticipant(id),
      notice,
    },
    me: effective,
    identityNotice: notice,
    identityError: verification.status === 'pending' ? verification.message : null,
  };
};

const createPollLoader = (deps: PollActionDeps, state: RequestState) => {
  const { api, storage, dispatch, location } = deps;
  return async (id: string, adminToken: string | null): Promise<boolean> => {
    const session = state.held;
    if (!session || session.id !== id) return false;
    state.inFlight?.abort();
    const controller = new AbortController();
    state.inFlight = controller;
    const seq = ++state.issued;
    const hash = location.readHash();
    const isCurrent = () =>
      !controller.signal.aborted && seq === state.issued && state.held === session && location.readHash() === hash;
    try {
      const candidate = session.me;
      const [event, initialVerification] = await Promise.all([
        api.getEvent(id, { adminToken, participant: candidate }, controller.signal),
        candidate && !session.verified
          ? validIdentity(api, id, candidate, controller.signal)
          : Promise.resolve<Verification>({ status: candidate ? 'valid' : 'invalid' }),
      ]);
      if (!isCurrent()) return false;
      const resolved = await resolveIdentity(deps, session, event, initialVerification, controller.signal, isCurrent);
      if (!resolved || !isCurrent()) return false;
      state.applied = seq;
      const { held, ...identity } = rememberCredentials(storage, session, event, adminToken, resolved);
      state.held = held;
      dispatch({ type: 'poll/loaded', id, event, ...identity });
      return true;
    } catch (err) {
      if (!isCurrent() || seq <= state.applied) return false;
      state.applied = seq;
      dispatch({ type: 'poll/failed', id, error: { message: describeError(err), gone: isGone(err) } });
      return false;
    } finally {
      if (state.inFlight === controller) state.inFlight = null;
    }
  };
};

const capturePollSession = (
  { storage, location }: PollActionDeps,
  state: RequestState,
  id: string,
  navigationKey?: string,
  routerHash?: string,
): CapturedPoll | null => {
  // Capture credentials in memory and strip the fragment immediately, even when storage is blocked.
  const hash = location.readHash();
  const fromHash = parseAdminHash(hash);
  const kept = state.held?.id === id ? state.held : null;
  const explicit = hasParticipantHash(hash);
  // StrictMode can repeat an effect with the router's old fragment just after the first run stripped it.
  if (kept && !explicit && !fromHash && routerHash && (hasParticipantHash(routerHash) || parseAdminHash(routerHash)))
    return null;
  const reuse = !explicit && !fromHash && kept?.navigationKey === navigationKey ? kept : null;
  // The router's fragment-stripping update must reuse the capture instead of aborting it.
  if (reuse && state.inFlight) return null;
  const saved = reuse ? reuse.saved : storage.getParticipant(id);
  const linked = explicit ? parseParticipantHash(hash) : null;
  const otherProfile = !!(linked && saved && linked.id !== saved.id);
  // A private link cannot switch a browser that already has its own profile for this poll.
  // Ignore its admin credential too, including on a malformed private link.
  const incomingAdmin = explicit && saved && linked?.id !== saved.id ? null : fromHash;
  const savedAdmin = storage.getAdminToken(id);
  // Preserve admin recovery through an outage; replace a different saved token only after verification.
  if (incomingAdmin && !savedAdmin) storage.setAdminToken(id, incomingAdmin);
  const adminToken = incomingAdmin ?? savedAdmin ?? kept?.adminToken ?? null;
  const me = explicit ? (otherProfile ? saved : (linked ?? saved)) : reuse ? reuse.me : saved;
  const capturedKey = fromHash || explicit ? replaceHash(location, id, '') : undefined;
  return {
    id,
    navigationKey: capturedKey ?? navigationKey,
    adminToken,
    me,
    saved,
    verified: sameIdentity(me, kept?.me ?? null) && (reuse?.verified ?? false),
    fromLink: (explicit && !otherProfile) || (reuse?.fromLink ?? false),
    notice: otherProfile ? savedProfileNotice : explicit && !linked ? invalidLinkNotice : (reuse?.notice ?? null),
  };
};

export function createPollActions(deps: PollActionDeps): PollActions {
  const { storage, dispatch, getState, location } = deps;
  const state: RequestState = { issued: 0, applied: 0, inFlight: null, held: null };
  const load = createPollLoader(deps, state);
  return {
    openPoll: async (id, navigationKey, routerHash) => {
      const held = capturePollSession(deps, state, id, navigationKey, routerHash);
      if (!held) return;
      state.held = held;
      const { adminToken, me } = held;
      dispatch({ type: 'poll/open', id, adminToken, me });
      await load(id, adminToken);
    },

    refresh: async (id) => {
      const poll = getState().poll;
      if (!poll || poll.id !== id) return false;
      return load(id, poll.adminToken);
    },

    setIdentity: (id, me) => {
      const held = state.held;
      // Removing the current identity must not remove a newer profile saved by another tab.
      if (me || held?.id !== id || sameIdentity(storage.getParticipant(id), held.me)) storage.setParticipant(id, me);
      if (held?.id === id)
        state.held = {
          ...held,
          me,
          verified: me !== null,
          saved: storage.getParticipant(id),
          fromLink: false,
          notice: null,
        };
      const poll = getState().poll;
      if (poll?.id === id) {
        dispatch({ type: 'poll/identity', id, me });
      }
    },

    forgetPoll: (id) => {
      storage.setAdminToken(id, null);
      storage.setParticipant(id, null);
      if (state.held?.id === id) state.held = null;
      if (getState().poll?.id === id) {
        replaceHash(location, id, '');
        dispatch({ type: 'poll/close', id });
      }
    },

    setResultsOnly: (id, value) => {
      dispatch({ type: 'poll/resultsOnly', id, value });
    },
  };
}

/** The real browser location for the provider; tests pass a fake. */
export const browserLocation: PollActionDeps['location'] = {
  readHash: () => window.location.hash,
  replaceHash: (id, hash) => {
    // The store can still hold the last poll after EventPage unmounts. A late response must not
    // attach its private link to the home page or another route.
    if (window.location.pathname.replace(/\/$/, '') !== `/e/${encodeURIComponent(id)}`) return;
    // Native fragment navigation can reuse the history key. Give each captured visit a distinct
    // key while keeping its history position/user state, then sync the router with the public URL.
    // Otherwise reopening the same private link is invisible to it, and Back cannot restore the
    // saved identity between two entries whose fragments were both stripped.
    const key = crypto.randomUUID();
    window.history.replaceState(
      { ...window.history.state, key },
      '',
      window.location.pathname + window.location.search + hash,
    );
    window.dispatchEvent(new Event('popstate'));
    return key;
  },
};
