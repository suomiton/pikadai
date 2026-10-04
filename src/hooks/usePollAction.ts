import { useCallback } from 'react';
import { isParticipantDisabled } from '../lib/errors';
import { usePoll, usePollActions } from '../state/AppStateProvider';
import { useAsyncAction, type AsyncAction } from './useAsyncAction';

/**
 * `useAsyncAction` for a change a participant makes to the poll on screen. Nothing refreshes the poll by
 * itself, so when the organiser has disabled the viewer since the page loaded, the first refused change,
 * whichever it is, re-fetches the poll and the page turns read-only.
 */
export function usePollAction(): AsyncAction {
  const { event } = usePoll();
  const { refresh } = usePollActions();
  const eventId = event.id;
  const onError = useCallback(
    (err: unknown) => {
      if (isParticipantDisabled(err)) void refresh(eventId);
    },
    [eventId, refresh],
  );
  return useAsyncAction(onError);
}
