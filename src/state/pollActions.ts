import { ApiRequestError, type api as apiModule } from '../lib/api';
import { describeError } from '../lib/errors';
import type { ParticipantIdentity, storage as storageModule } from '../lib/storage';
import { hasParticipant, parseAdminHash, type AppAction, type AppState } from './app';

/**
 * The side effects around the poll session: fetching, reading and writing the tokens in
 * localStorage, and the admin-link fragment. Every dependency is injected so the module runs under
 * Node with fakes; the provider wires in the real ones.
 */
export interface PollActionDeps {
  api: Pick<typeof apiModule, 'getEvent'>;
  storage: typeof storageModule;
  dispatch: (action: AppAction) => void;
  getState: () => AppState;
  location: { readHash(): string; clearHash(): void };
}

/**
 * Every action names the poll it is about. A mutation's callback runs when the request finishes,
 * which can be after the user has moved on to another poll; its credentials must still land under
 * the poll they belong to, and the poll now on screen must be left alone.
 */
export interface PollActions {
  /** Start viewing a poll: pick up the admin token and identity, then fetch. Runs once per route id. */
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

  async function load(id: string, adminToken: string | null): Promise<boolean> {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    const seq = ++issued;
    try {
      const event = await api.getEvent(id, adminToken, controller.signal);
      if (seq <= applied) return false;
      applied = seq;
      // The reducer drops an identity the poll no longer lists; mirror that in storage.
      const poll = getState().poll;
      if (poll?.id === id && poll.me && !hasParticipant(event, poll.me)) storage.setParticipant(id, null);
      dispatch({ type: 'poll/loaded', id, event });
      return true;
    } catch (err) {
      if (controller.signal.aborted || seq <= applied) return false;
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
       * server. Move it into storage first and strip it from the address bar so a copied URL or a
       * screenshot does not leak it.
       */
      const fromHash = parseAdminHash(location.readHash());
      if (fromHash !== null) {
        storage.setAdminToken(id, fromHash);
        location.clearHash();
      }
      const kept = held?.id === id ? held : null;
      const adminToken = fromHash ?? storage.getAdminToken(id) ?? kept?.adminToken ?? null;
      const me = storage.getParticipant(id) ?? kept?.me ?? null;
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
      if (getState().poll?.id === id) dispatch({ type: 'poll/identity', id, me });
    },

    forgetPoll(id) {
      storage.setAdminToken(id, null);
      storage.setParticipant(id, null);
      if (held?.id === id) held = null;
      if (getState().poll?.id === id) dispatch({ type: 'poll/close', id });
    },
  };
}

/** The real browser location for the provider; tests pass a fake. */
export const browserLocation: PollActionDeps['location'] = {
  readHash: () => window.location.hash,
  clearHash: () => window.history.replaceState(null, '', window.location.pathname + window.location.search),
};
