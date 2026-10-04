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
}

/** The server says the poll no longer exists: deleted (404) or expired (410). */
function isGone(err: unknown): boolean {
  return err instanceof ApiRequestError && (err.status === 404 || err.status === 410);
}

function sameIdentity(a: ParticipantIdentity | null, b: ParticipantIdentity | null): boolean {
  return a?.id === b?.id && a?.token === b?.token;
}

type Verification = { status: 'valid' | 'invalid' } | { status: 'pending'; message: string };
const invalidLinkNotice = 'This private link is no longer valid.';
const sessionNotice = 'You are using this private link for this visit. Your saved name on this device has not changed.';

export function createPollActions({ api, storage, dispatch, getState, location }: PollActionDeps): PollActions {
  /*
   * Fetches are numbered, and a result is applied only when nothing newer has been applied yet.
   * Otherwise two overlapping refreshes could leave the older response in state, and if that
   * response predates a participant this browser just created, it would also clear their identity
   * from state and storage. Starting a fetch aborts the one before it; an aborted fetch reports
   * nothing and its successor does.
   */
  let issued = 0;
  let applied = 0;
  let inFlight: AbortController | null = null;

  /*
   * The credentials handed to the poll opened last. Storage can be blocked (private mode, site data
   * disabled), and when the opening effect runs twice (StrictMode in development) the store has not
   * re-rendered with the first run's dispatch before the second run reads it. This copy survives
   * both, so the second run still fetches as the organiser or the participant.
   */
  let held: {
    id: string;
    navigationKey: string | undefined;
    adminToken: string | null;
    me: ParticipantIdentity | null;
    verified: boolean;
    saved: ParticipantIdentity | null;
    fromLink: boolean;
    notice: string | null;
  } | null = null;

  function replaceHash(id: string, hash: string) {
    if (location.readHash() !== hash) return location.replaceHash(id, hash);
  }

  async function validIdentity(id: string, me: ParticipantIdentity, signal: AbortSignal): Promise<Verification> {
    try {
      await api.verifyParticipant(id, me, signal);
      return { status: 'valid' };
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 403 && err.code === 'not_owner')
        return { status: 'invalid' };
      // Keep the poll readable and the candidate in memory; only identity-dependent actions wait.
      return { status: 'pending', message: describeError(err) };
    }
  }

  async function load(id: string, adminToken: string | null): Promise<boolean> {
    const session = held;
    if (!session || session.id !== id) return false;
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    const seq = ++issued;
    const hash = location.readHash();
    const isCurrent = () =>
      !controller.signal.aborted && seq === issued && held === session && location.readHash() === hash;
    try {
      let candidate = session.me;
      const [event, initialVerification] = await Promise.all([
        api.getEvent(id, adminToken, controller.signal),
        candidate && !session.verified
          ? validIdentity(id, candidate, controller.signal)
          : Promise.resolve<Verification>({ status: candidate ? 'valid' : 'invalid' }),
      ]);
      if (!isCurrent()) return false;
      let verification = initialVerification;
      let notice = session.notice;
      const rejected: ParticipantIdentity[] = [];
      if (candidate && (!hasParticipant(event, candidate) || verification.status === 'invalid')) {
        rejected.push(candidate);
        candidate = session.fromLink && !sameIdentity(candidate, session.saved) ? session.saved : null;
        if (session.fromLink) notice = invalidLinkNotice;
        verification =
          candidate && hasParticipant(event, candidate)
            ? await validIdentity(id, candidate, controller.signal)
            : { status: 'invalid' };
        if (!isCurrent()) return false;
      }
      if (candidate && verification.status === 'invalid') {
        rejected.push(candidate);
        candidate = null;
      }
      applied = seq;
      for (const identity of rejected) {
        if (sameIdentity(storage.getParticipant(id), identity)) storage.setParticipant(id, null);
      }
      const effective = verification.status === 'valid' ? candidate : null;
      const saved = storage.getParticipant(id);
      if (effective) {
        if (!saved || sameIdentity(saved, effective)) storage.setParticipant(id, effective);
        else notice = sessionNotice;
      }
      const effectiveAdmin = event.viewer.isAdmin ? adminToken : null;
      if (effectiveAdmin) storage.setAdminToken(id, effectiveAdmin);
      else if (adminToken && storage.getAdminToken(id) === adminToken) storage.setAdminToken(id, null);
      held = {
        ...session,
        adminToken: effectiveAdmin,
        me: candidate,
        verified: verification.status === 'valid',
        saved: storage.getParticipant(id),
        notice,
      };
      dispatch({
        type: 'poll/loaded',
        id,
        event,
        me: effective,
        identityNotice: notice,
        identityError: verification.status === 'pending' ? verification.message : null,
      });
      return true;
    } catch (err) {
      if (!isCurrent() || seq <= applied) return false;
      applied = seq;
      dispatch({ type: 'poll/failed', id, error: { message: describeError(err), gone: isGone(err) } });
      return false;
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  }

  return {
    async openPoll(id, navigationKey, routerHash) {
      /*
       * The admin link carries its token in the URL fragment, which browsers never send to the
       * server. Capture credentials in memory and strip them immediately, so copying the address
       * bar or using a mobile share sheet sends the public link, even when storage is blocked.
       */
      const hash = location.readHash();
      const fromHash = parseAdminHash(hash);
      const kept = held?.id === id ? held : null;
      const explicit = hasParticipantHash(hash);
      // StrictMode can repeat an effect with the router's old fragment just after the first run
      // stripped it. Keep that captured identity until the router observes the public URL.
      if (
        kept &&
        !explicit &&
        !fromHash &&
        routerHash &&
        (hasParticipantHash(routerHash) || parseAdminHash(routerHash))
      )
        return;
      const reuse = !explicit && !fromHash && kept?.navigationKey === navigationKey ? kept : null;
      // Stripping a fragment notifies the router; that follow-up effect must reuse the capture in
      // progress instead of aborting it and spending another read/verification request.
      if (reuse && inFlight) return;
      const saved = reuse ? reuse.saved : storage.getParticipant(id);
      const linked = explicit ? parseParticipantHash(hash) : null;
      const savedAdmin = storage.getAdminToken(id);
      // Preserve first-time admin recovery through a poll-fetch outage, without overwriting a
      // different saved token until the server confirms the incoming one.
      if (fromHash && !savedAdmin) storage.setAdminToken(id, fromHash);
      const adminToken = fromHash ?? savedAdmin ?? kept?.adminToken ?? null;
      const me = explicit ? (linked ?? saved) : reuse ? reuse.me : saved;
      const capturedKey = fromHash || explicit ? replaceHash(id, '') : undefined;
      held = {
        id,
        navigationKey: capturedKey ?? navigationKey,
        adminToken,
        me,
        saved,
        verified: sameIdentity(me, kept?.me ?? null) && (reuse?.verified ?? false),
        fromLink: explicit || (reuse?.fromLink ?? false),
        notice: explicit && !linked ? invalidLinkNotice : (reuse?.notice ?? null),
      };
      dispatch({ type: 'poll/open', id, adminToken, me });
      await load(id, adminToken);
    },

    async refresh(id) {
      const poll = getState().poll;
      if (!poll || poll.id !== id) return false;
      return load(id, poll.adminToken);
    },

    setIdentity(id, me) {
      // Removing a session-only identity must not remove the different one saved on this device.
      if (me || held?.id !== id || sameIdentity(storage.getParticipant(id), held.me)) storage.setParticipant(id, me);
      if (held?.id === id)
        held = {
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

    forgetPoll(id) {
      storage.setAdminToken(id, null);
      storage.setParticipant(id, null);
      if (held?.id === id) held = null;
      if (getState().poll?.id === id) {
        replaceHash(id, '');
        dispatch({ type: 'poll/close', id });
      }
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
