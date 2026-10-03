import { describe, expect, it } from 'vitest';
import type { Participant } from '@shared/types';
import { initialVoteEditor, voteEditorReducer, type VoteEditorState } from './voteEditor';

const ada: Participant = { id: 'p1', nickname: 'Ada', votes: { o1: 'yes', o2: 'no' }, createdAt: 0 };

const toggle = (state: VoteEditorState, optionId: string): VoteEditorState =>
  voteEditorReducer(state, { type: 'toggle', optionId });

describe('voteEditorReducer', () => {
  it('opens a blank editor for a new answer and remembers the Add button opened it', () => {
    const state = voteEditorReducer(initialVoteEditor, { type: 'startNew' });
    expect(state).toEqual({
      editing: { kind: 'new' },
      opener: { kind: 'add' },
      nickname: '',
      draftVotes: {},
      turnstileToken: null,
    });
  });

  it('opens an existing answer with a copy of its votes and remembers which row opened it', () => {
    const state = voteEditorReducer(initialVoteEditor, { type: 'startEdit', participant: ada });
    expect(state.editing).toEqual({ kind: 'existing', participantId: 'p1' });
    expect(state.opener).toEqual({ kind: 'edit', participantId: 'p1' });
    expect(state.nickname).toBe('Ada');
    expect(state.draftVotes).toEqual(ada.votes);
    expect(state.draftVotes).not.toBe(ada.votes);
  });

  it('cycles a cell through yes, if need be, no and back to no answer', () => {
    const fresh = voteEditorReducer(initialVoteEditor, { type: 'startNew' });
    const yes = toggle(fresh, 'o1');
    expect(yes.draftVotes).toEqual({ o1: 'yes' });
    const maybe = toggle(yes, 'o1');
    expect(maybe.draftVotes).toEqual({ o1: 'maybe' });
    const no = toggle(maybe, 'o1');
    expect(no.draftVotes).toEqual({ o1: 'no' });
    const none = toggle(no, 'o1');
    expect(none.draftVotes).toEqual({});
  });

  it('edits the nickname and stores the Turnstile token', () => {
    const fresh = voteEditorReducer(initialVoteEditor, { type: 'startNew' });
    const named = voteEditorReducer(fresh, { type: 'nickname', value: 'Grace' });
    const verified = voteEditorReducer(named, { type: 'turnstile', token: 'tok' });
    expect(verified.nickname).toBe('Grace');
    expect(verified.turnstileToken).toBe('tok');
  });

  it('closes the editor and drops the token but keeps the opener for the focus return', () => {
    const editing = voteEditorReducer(initialVoteEditor, { type: 'startEdit', participant: ada });
    const verified = voteEditorReducer(editing, { type: 'turnstile', token: 'tok' });
    const closed = voteEditorReducer(verified, { type: 'close' });
    expect(closed.editing).toBeNull();
    expect(closed.turnstileToken).toBeNull();
    expect(closed.opener).toEqual({ kind: 'edit', participantId: 'p1' });
  });
});
