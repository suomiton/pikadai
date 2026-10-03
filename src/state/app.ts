import type { EventView } from '@shared/types';
import type { ParticipantIdentity } from '../lib/storage';

/**
 * The root store. It holds the one thing the poll page's sections share: the poll being viewed,
 * who the viewer is to it, and whether it has loaded. Form drafts stay in the components that own
 * them. The reducer is pure; `pollActions.ts` does the fetching and the storage writes.
 */
export interface PollSession {
  id: string;
  /** Kept only once the server has confirmed `viewer.isAdmin`, so it is always the effective token. */
  adminToken: string | null;
  me: ParticipantIdentity | null;
  /** Null while loading or after a failed first load. */
  event: EventView | null;
  /** Message from the last failed load. */
  error: string | null;
}

export interface AppState {
  poll: PollSession | null;
}

export type AppAction =
  | { type: 'poll/open'; id: string; adminToken: string | null; me: ParticipantIdentity | null }
  | { type: 'poll/loaded'; id: string; event: EventView }
  | { type: 'poll/failed'; id: string; error: string }
  | { type: 'poll/identity'; me: ParticipantIdentity | null }
  | { type: 'poll/close' };

export const initialAppState: AppState = { poll: null };

/** Whether the stored identity still names a participant in this poll. */
export function hasParticipant(event: EventView, me: ParticipantIdentity | null): boolean {
  return me !== null && event.participants.some((p) => p.id === me.id);
}

/** The admin token an `/e/:id#admin=TOKEN` link carries, or null. */
export function parseAdminHash(hash: string): string | null {
  const match = /(?:^#|[#&])admin=([A-Za-z0-9_-]+)/.exec(hash);
  return match ? match[1] : null;
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'poll/open':
      return { poll: { id: action.id, adminToken: action.adminToken, me: action.me, event: null, error: null } };

    case 'poll/loaded': {
      const poll = state.poll;
      // A response for a poll the user has since left must not overwrite the current one.
      if (!poll || poll.id !== action.id) return state;
      return {
        poll: {
          ...poll,
          event: action.event,
          error: null,
          me: hasParticipant(action.event, poll.me) ? poll.me : null,
          adminToken: action.event.viewer.isAdmin ? poll.adminToken : null,
        },
      };
    }

    case 'poll/failed': {
      const poll = state.poll;
      if (!poll || poll.id !== action.id) return state;
      return { poll: { ...poll, error: action.error } };
    }

    case 'poll/identity':
      if (!state.poll) return state;
      return { poll: { ...state.poll, me: action.me } };

    case 'poll/close':
      return { poll: null };
  }
}
