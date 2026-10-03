import { useCallback, useReducer } from 'react';
import type { Answer, EventOption, Participant } from '@shared/types';
import { cycle } from '../lib/votes';
import { initialVoteEditor, voteEditorReducer, type VoteEditorState } from '../state/voteEditor';

export interface VoteEditor {
  state: VoteEditorState;
  startEdit(participant: Participant): void;
  /** Close the editor; whose row it was is kept for the focus return. */
  close(): void;
  /** Cycle a cell and return the answer it now shows, for the live region. */
  toggle(option: EventOption): Answer | undefined;
  setNickname(value: string): void;
  /** Drop draft votes for dates no longer in the poll. Stable, so an effect can depend on it. */
  syncOptions(optionIds: readonly string[]): void;
}

/** The editing state machine of the availability table, with its transitions bound to dispatch. */
export function useVoteEditor(): VoteEditor {
  const [state, dispatch] = useReducer(voteEditorReducer, initialVoteEditor);
  const syncOptions = useCallback((optionIds: readonly string[]) => dispatch({ type: 'options', optionIds }), []);
  return {
    state,
    syncOptions,
    startEdit: (participant) => dispatch({ type: 'startEdit', participant }),
    close: () => dispatch({ type: 'close' }),
    toggle: (option) => {
      const next = cycle(state.draftVotes[option.id]);
      dispatch({ type: 'toggle', optionId: option.id });
      return next;
    },
    setNickname: (value) => dispatch({ type: 'nickname', value }),
  };
}
