import type { api as apiModule } from '../lib/api';
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

export interface PollActions {
  /** Start viewing a poll: pick up the admin token and identity, then fetch. Runs once per route id. */
  openPoll(id: string): Promise<void>;
  /** Re-fetch the current poll after a mutation. */
  refresh(): Promise<void>;
  /** Remember (or forget, with null) which participant this browser is in the current poll. */
  setIdentity(me: ParticipantIdentity | null): void;
  /** Drop every token for the current poll and close the session; used after the organiser deletes it. */
  forgetPoll(): void;
}

export function createPollActions({ api, storage, dispatch, getState, location }: PollActionDeps): PollActions {
  async function load(id: string, adminToken: string | null): Promise<void> {
    try {
      const event = await api.getEvent(id, adminToken);
      // The reducer drops an identity the poll no longer lists; mirror that in storage.
      const poll = getState().poll;
      if (poll?.id === id && poll.me && !hasParticipant(event, poll.me)) storage.setParticipant(id, null);
      dispatch({ type: 'poll/loaded', id, event });
    } catch (err) {
      dispatch({ type: 'poll/failed', id, error: describeError(err) });
    }
  }

  return {
    async openPoll(id) {
      /*
       * The admin link carries its token in the URL fragment, which browsers never send to the
       * server. Move it into storage first and strip it from the address bar so a copied URL or a
       * screenshot does not leak it. Storage is written before anything else so that a second run
       * of the opening effect (StrictMode in development) finds the token even though the hash
       * is already gone.
       */
      const fromHash = parseAdminHash(location.readHash());
      if (fromHash !== null) {
        storage.setAdminToken(id, fromHash);
        location.clearHash();
      }
      const adminToken = fromHash ?? storage.getAdminToken(id);
      dispatch({ type: 'poll/open', id, adminToken, me: storage.getParticipant(id) });
      await load(id, adminToken);
    },

    async refresh() {
      const poll = getState().poll;
      if (!poll) return;
      await load(poll.id, poll.adminToken);
    },

    setIdentity(me) {
      const poll = getState().poll;
      if (!poll) return;
      storage.setParticipant(poll.id, me);
      dispatch({ type: 'poll/identity', me });
    },

    forgetPoll() {
      const poll = getState().poll;
      if (!poll) return;
      storage.setAdminToken(poll.id, null);
      storage.setParticipant(poll.id, null);
      dispatch({ type: 'poll/close' });
    },
  };
}

/** The real browser location for the provider; tests pass a fake. */
export const browserLocation: PollActionDeps['location'] = {
  readHash: () => window.location.hash,
  clearHash: () => window.history.replaceState(null, '', window.location.pathname + window.location.search),
};
