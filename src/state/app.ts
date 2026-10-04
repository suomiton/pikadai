import type { EventView } from '@shared/types';
import type { ParticipantIdentity } from '../lib/storage';

/**
 * The root store. It holds the one thing the poll page's sections share: the poll being viewed,
 * who the viewer is to it, and whether it has loaded. Form drafts stay in the components that own
 * them. The reducer is pure; `pollActions.ts` does the fetching and the storage writes.
 */
export interface LoadError {
  /** User-facing text from `describeError`. */
  message: string;
  /** The server said the poll no longer exists (deleted or expired), so a loaded event is dropped. */
  gone: boolean;
}

export interface PollSession {
  id: string;
  /** Kept only once the server has confirmed `viewer.isAdmin`, so it is always the effective token. */
  adminToken: string | null;
  me: ParticipantIdentity | null;
  /** Null while loading, after a failed first load, or once the poll is gone. */
  event: EventView | null;
  /** The last failed load; cleared by the next successful one. A loaded event stays through a transient failure. */
  error: LoadError | null;
  /** A link was rejected or is being used without replacing this device's saved identity. */
  identityNotice: string | null;
  /** The poll loaded, but participant verification needs a retry. `me` stays null until then. */
  identityError: string | null;
}

export interface AppState {
  poll: PollSession | null;
}

/** Every action names its poll, so a result or write for a poll the user has left cannot touch the current one. */
export type AppAction =
  | { type: 'poll/open'; id: string; adminToken: string | null; me: ParticipantIdentity | null }
  | {
      type: 'poll/loaded';
      id: string;
      event: EventView;
      me?: ParticipantIdentity | null;
      identityNotice?: string | null;
      identityError?: string | null;
    }
  | { type: 'poll/failed'; id: string; error: LoadError }
  | { type: 'poll/identity'; id: string; me: ParticipantIdentity | null }
  | { type: 'poll/close'; id: string };

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
  const poll = state.poll;
  if (action.type === 'poll/open') {
    return {
      poll: {
        id: action.id,
        adminToken: action.adminToken,
        me: action.me,
        event: null,
        error: null,
        identityNotice: null,
        identityError: null,
      },
    };
  }
  // Everything else is about the poll on screen; anything for another poll is stale and ignored.
  if (!poll || poll.id !== action.id) return state;

  switch (action.type) {
    case 'poll/loaded': {
      const me = action.me === undefined ? poll.me : action.me;
      return {
        poll: {
          ...poll,
          event: action.event,
          error: null,
          identityNotice: action.identityNotice ?? null,
          identityError: action.identityError ?? null,
          me: hasParticipant(action.event, me) ? me : null,
          adminToken: action.event.viewer.isAdmin ? poll.adminToken : null,
        },
      };
    }

    case 'poll/failed':
      return { poll: { ...poll, error: action.error, event: action.error.gone ? null : poll.event } };

    case 'poll/identity':
      return { poll: { ...poll, me: action.me, identityNotice: null, identityError: null } };

    case 'poll/close':
      return { poll: null };
  }
}
