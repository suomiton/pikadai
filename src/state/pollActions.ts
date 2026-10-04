import { ApiRequestError, type api as apiModule } from '../lib/api';
import { describeError } from '../lib/errors';
import { hasParticipantHash, parseParticipantHash, participantHash } from '../lib/participantLink';
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
  location: { readHash(): string; replaceHash(id: string, hash: string): void };
}

/**
 * Every action names the poll it is about. A mutation's callback runs when the request finishes,
 * which can be after the user has moved on to another poll; its credentials must still land under
 * the poll they belong to, and the poll now on screen must be left alone.
 */
export interface PollActions {
  /** Start viewing a poll: pick up private-link or stored credentials, validate the identity, then fetch. */
  openPoll(id: string): Promise<void>;
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
  let held: { id: string; adminToken: string | null; me: ParticipantIdentity | null } | null = null;

  function replaceHash(id: string, hash: string) {
    if (location.readHash() !== hash) location.replaceHash(id, hash);
  }

  async function validIdentity(id: string, me: ParticipantIdentity | null, signal: AbortSignal): Promise<boolean> {
    if (!me) return false;
    try {
      await api.verifyParticipant(id, me, signal);
      return true;
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 403 && err.code === 'not_owner') return false;
      // An outage must not erase a valid private link or the stored identity; the user can retry.
      throw err;
    }
  }

  async function load(id: string, adminToken: string | null): Promise<boolean> {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    const seq = ++issued;
    const me = held?.id === id ? held.me : null;
    const hash = location.readHash();
    try {
      const [event, verified] = await Promise.all([
        api.getEvent(id, adminToken, controller.signal),
        validIdentity(id, me, controller.signal),
      ]);
      if (
        controller.signal.aborted ||
        seq !== issued ||
        held?.id !== id ||
        held.me !== me ||
        location.readHash() !== hash
      )
        return false;
      applied = seq;
      const effective = verified && hasParticipant(event, me) ? me : null;
      if (effective) {
        storage.setParticipant(id, effective);
      } else if (me) {
        // A bad link must not erase a different, valid identity already saved in this browser.
        const saved = storage.getParticipant(id);
        if (saved?.id === me.id && saved.token === me.token) storage.setParticipant(id, null);
        dispatch({ type: 'poll/identity', id, me: null });
      }
      held = { id, adminToken: event.viewer.isAdmin ? adminToken : null, me: effective };
      if (effective) replaceHash(id, participantHash(effective, held.adminToken));
      else if (hasParticipantHash(location.readHash())) {
        replaceHash(id, held.adminToken ? `#admin=${encodeURIComponent(held.adminToken)}` : '');
      }
      dispatch({ type: 'poll/loaded', id, event });
      return true;
    } catch (err) {
      if (controller.signal.aborted || seq <= applied || seq !== issued || location.readHash() !== hash) return false;
      applied = seq;
      dispatch({ type: 'poll/failed', id, error: { message: describeError(err), gone: isGone(err) } });
      return false;
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  }

  return {
    async openPoll(id) {
      /*
       * The admin link carries its token in the URL fragment, which browsers never send to the
       * server. Standalone admin links move into storage and are stripped. Combined private links
       * retain both credentials so the organiser can restore their identity and permissions elsewhere.
       */
      const hash = location.readHash();
      const fromHash = parseAdminHash(hash);
      if (fromHash !== null) {
        storage.setAdminToken(id, fromHash);
        if (!hasParticipantHash(hash)) replaceHash(id, '');
      }
      const kept = held?.id === id ? held : null;
      const adminToken = fromHash ?? storage.getAdminToken(id) ?? kept?.adminToken ?? null;
      const me = hasParticipantHash(hash)
        ? parseParticipantHash(hash)
        : (storage.getParticipant(id) ?? kept?.me ?? null);
      held = { id, adminToken, me };
      dispatch({ type: 'poll/open', id, adminToken, me });
      await load(id, adminToken);
    },

    async refresh(id) {
      const poll = getState().poll;
      if (!poll || poll.id !== id) return false;
      return load(id, poll.adminToken);
    },

    setIdentity(id, me) {
      storage.setParticipant(id, me);
      if (held?.id === id) held = { ...held, me };
      const poll = getState().poll;
      if (poll?.id === id) {
        dispatch({ type: 'poll/identity', id, me });
        replaceHash(
          id,
          me
            ? participantHash(me, poll.adminToken)
            : poll.adminToken
              ? `#admin=${encodeURIComponent(poll.adminToken)}`
              : '',
        );
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
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + hash);
  },
};
