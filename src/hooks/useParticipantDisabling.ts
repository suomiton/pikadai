import type { Participant } from '@shared/types';
import { api } from '../lib/api';
import { usePoll, usePollActions } from '../state/AppStateProvider';
import type { AsyncAction } from './useAsyncAction';
import type { VoteEditor } from './useVoteEditor';
import type { VoteEditorFocus } from './useVoteEditorFocus';

/**
 * The organiser disables a participant, or enables them again, from that person's open row. It applies at
 * once without a confirmation because it can be undone; the row closes and focus returns to its Edit button.
 */
export function useParticipantDisabling(
  editor: VoteEditor,
  { run }: AsyncAction,
  focus: VoteEditorFocus,
  setStatus: (value: string) => void,
) {
  const { event, adminToken } = usePoll();
  const { refresh } = usePollActions();

  return async (participant: Participant, disabled: boolean) => {
    if (!adminToken) return;
    const done = await run(async () => {
      await api.setParticipantDisabled(event.id, participant.id, { disabled }, adminToken);
      editor.close();
      await refresh(event.id);
    });
    if (!done) return;
    setStatus(
      disabled
        ? `${participant.name} was disabled. Their answers no longer count, and only you can see them.`
        : `${participant.name} was enabled again. Their answers count and everyone can see them.`,
    );
    focus.requestFocus('return');
  };
}
