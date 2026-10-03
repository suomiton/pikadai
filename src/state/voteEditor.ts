import type { Answer, Participant } from '@shared/types';
import { cycle } from '../lib/votes';

/**
 * The state machine behind the availability table's editing row: whose row is being edited, the
 * draft name and votes, and whose Edit button gets focus back when the editor closes. A
 * participant row exists before it is edited, because joining the poll creates it; see JoinForm.
 * Pure; `useVoteEditor` binds it to a component.
 */
export interface VoteEditorState {
  /** The participant whose row is open for editing, or null while the editor is closed. */
  editingId: string | null;
  /** Whose Edit button receives focus when the editor closes; kept after `close` for that reason. */
  returnTo: string | null;
  name: string;
  draftVotes: Record<string, Answer>;
}

export type VoteEditorAction =
  | { type: 'startEdit'; participant: Participant }
  | { type: 'close' }
  | { type: 'toggle'; optionId: string }
  | { type: 'name'; value: string }
  /** The poll's current dates; a draft vote for any other date is dropped (the organiser removed it). */
  | { type: 'options'; optionIds: readonly string[] };

export const initialVoteEditor: VoteEditorState = {
  editingId: null,
  returnTo: null,
  name: '',
  draftVotes: {},
};

export function voteEditorReducer(state: VoteEditorState, action: VoteEditorAction): VoteEditorState {
  switch (action.type) {
    case 'startEdit': {
      const { id, name, votes } = action.participant;
      return { ...state, editingId: id, returnTo: id, name, draftVotes: { ...votes } };
    }
    case 'close':
      return { ...state, editingId: null };
    case 'toggle': {
      const next = cycle(state.draftVotes[action.optionId]);
      const draftVotes = { ...state.draftVotes };
      if (next === undefined) delete draftVotes[action.optionId];
      else draftVotes[action.optionId] = next;
      return { ...state, draftVotes };
    }
    case 'name':
      return { ...state, name: action.value };
    case 'options': {
      const stale = Object.keys(state.draftVotes).filter((optionId) => !action.optionIds.includes(optionId));
      if (stale.length === 0) return state;
      const draftVotes = { ...state.draftVotes };
      for (const optionId of stale) delete draftVotes[optionId];
      return { ...state, draftVotes };
    }
  }
}
