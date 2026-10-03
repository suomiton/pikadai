import type { Answer, Participant } from '@shared/types';
import { cycle } from '../lib/votes';

/**
 * The state machine behind the availability table's editing row: which row is being edited, the
 * draft nickname and votes, the Turnstile token for a first answer, and which control opened the
 * editor so focus can return to it. Pure; `useVoteEditor` binds it to a component.
 */
export type Editing = { kind: 'new' } | { kind: 'existing'; participantId: string } | null;

/** Which control opened the editor, so focus can go back to it when the editor closes. */
export type Opener = { kind: 'add' } | { kind: 'edit'; participantId: string } | null;

export interface VoteEditorState {
  editing: Editing;
  opener: Opener;
  nickname: string;
  draftVotes: Record<string, Answer>;
  turnstileToken: string | null;
}

export type VoteEditorAction =
  | { type: 'startNew' }
  | { type: 'startEdit'; participant: Participant }
  | { type: 'close' }
  | { type: 'toggle'; optionId: string }
  | { type: 'nickname'; value: string }
  | { type: 'turnstile'; token: string | null };

export const initialVoteEditor: VoteEditorState = {
  editing: null,
  opener: null,
  nickname: '',
  draftVotes: {},
  turnstileToken: null,
};

export function voteEditorReducer(state: VoteEditorState, action: VoteEditorAction): VoteEditorState {
  switch (action.type) {
    case 'startNew':
      return { ...state, editing: { kind: 'new' }, opener: { kind: 'add' }, nickname: '', draftVotes: {} };
    case 'startEdit': {
      const { id, nickname, votes } = action.participant;
      return {
        ...state,
        editing: { kind: 'existing', participantId: id },
        opener: { kind: 'edit', participantId: id },
        nickname,
        draftVotes: { ...votes },
      };
    }
    case 'close':
      return { ...state, editing: null, turnstileToken: null };
    case 'toggle': {
      const next = cycle(state.draftVotes[action.optionId]);
      const draftVotes = { ...state.draftVotes };
      if (next === undefined) delete draftVotes[action.optionId];
      else draftVotes[action.optionId] = next;
      return { ...state, draftVotes };
    }
    case 'nickname':
      return { ...state, nickname: action.value };
    case 'turnstile':
      return { ...state, turnstileToken: action.token };
  }
}
