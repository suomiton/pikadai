import { createContext, useContext, useLayoutEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import type { EventView } from '@shared/types';
import { api } from '../lib/api';
import { storage, type ParticipantIdentity } from '../lib/storage';
import { appReducer, initialAppState, type AppState } from './app';
import { browserLocation, createPollActions, type PollActions } from './pollActions';

interface AppContextValue {
  state: AppState;
  actions: PollActions;
}

const AppContext = createContext<AppContextValue | null>(null);

/** Wraps the router in main.tsx: one reducer for the shared state, reached through the hooks below. */
export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);

  // The actions read the latest state through this ref instead of closing over it, so they are
  // created once and never go stale. A layout effect updates the ref synchronously in the commit,
  // before any child's passive effect or event handler can call an action.
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  const actions = useMemo(
    () =>
      // getState is only ever called from an action, after the layout effect above has run; never during render.
      // eslint-disable-next-line react-hooks/refs
      createPollActions({
        api,
        storage,
        dispatch,
        getState: () => stateRef.current,
        location: browserLocation,
      }),
    [],
  );
  const value = useMemo(() => ({ state, actions }), [state, actions]);

  return <AppContext value={value}>{children}</AppContext>;
}

const useAppContext = (): AppContextValue => {
  const value = useContext(AppContext);
  if (!value) throw new Error('AppStateProvider is missing above this component');
  return value;
};

export function useAppState(): AppState {
  return useAppContext().state;
}

export function usePollActions(): PollActions {
  return useAppContext().actions;
}

export interface LoadedPoll {
  id: string;
  event: EventView;
  me: ParticipantIdentity | null;
  /** The organiser's token, or null for everyone else; already checked by the server. */
  adminToken: string | null;
  isAdmin: boolean;
  identityError: string | null;
  /** The visitor chose to see the results without joining; see `PollSession.resultsOnly`. */
  resultsOnly: boolean;
}

/** The poll on screen. Only for components EventPage renders once the event has loaded. */
export function usePoll(): LoadedPoll {
  const { poll } = useAppState();
  const loaded = useMemo<LoadedPoll | null>(
    () =>
      poll?.event
        ? {
            id: poll.id,
            event: poll.event,
            me: poll.me,
            adminToken: poll.adminToken,
            isAdmin: poll.event.viewer.isAdmin,
            identityError: poll.identityError,
            resultsOnly: poll.resultsOnly,
          }
        : null,
    [poll],
  );
  if (!loaded)
    throw new Error('usePoll() needs a loaded poll; render this component under EventPage once the event is there');
  return loaded;
}

/** The organiser's token. Only for components rendered when the viewer is the organiser. */
export function useAdminToken(): string {
  const { adminToken } = usePoll();
  if (adminToken === null)
    throw new Error('useAdminToken() needs the organiser; render this component only for the admin');
  return adminToken;
}
