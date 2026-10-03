import { describe, expect, it } from 'vitest';
import type { Participant } from '@shared/types';
import { initialVoteEditor, voteEditorReducer, type VoteEditorState } from './voteEditor';

const ada: Participant = {
  id: 'p1',
  name: 'Ada',
  votes: { o1: 'yes', o2: 'no' },
  createdAt: 0,
  isOrganiser: false,
};
const fresh: Participant = { id: 'p2', name: 'Grace', votes: {}, createdAt: 0, isOrganiser: false };

const toggle = (state: VoteEditorState, optionId: string): VoteEditorState =>
  voteEditorReducer(state, { type: 'toggle', optionId });

describe('voteEditorReducer', () => {
  it('opens a participant row with a copy of its votes and remembers whose row it is', () => {
    const state = voteEditorReducer(initialVoteEditor, { type: 'startEdit', participant: ada });
    expect(state.editingId).toBe('p1');
    expect(state.returnTo).toBe('p1');
    expect(state.name).toBe('Ada');
    expect(state.draftVotes).toEqual(ada.votes);
    expect(state.draftVotes).not.toBe(ada.votes);
  });

  it('opens a row that has no answers yet, as right after joining', () => {
    const state = voteEditorReducer(initialVoteEditor, { type: 'startEdit', participant: fresh });
    expect(state).toEqual({ editingId: 'p2', returnTo: 'p2', name: 'Grace', draftVotes: {} });
  });

  it('cycles a cell through yes, if need be, no and back to no answer', () => {
    const editing = voteEditorReducer(initialVoteEditor, { type: 'startEdit', participant: fresh });
    const yes = toggle(editing, 'o1');
    expect(yes.draftVotes).toEqual({ o1: 'yes' });
    const maybe = toggle(yes, 'o1');
    expect(maybe.draftVotes).toEqual({ o1: 'maybe' });
    const no = toggle(maybe, 'o1');
    expect(no.draftVotes).toEqual({ o1: 'no' });
    const none = toggle(no, 'o1');
    expect(none.draftVotes).toEqual({});
  });

  it('edits the name', () => {
    const editing = voteEditorReducer(initialVoteEditor, { type: 'startEdit', participant: ada });
    expect(voteEditorReducer(editing, { type: 'name', value: 'Ada L.' }).name).toBe('Ada L.');
  });

  it('drops draft votes for dates that are no longer in the poll and keeps the rest', () => {
    const editing = voteEditorReducer(initialVoteEditor, { type: 'startEdit', participant: ada });
    const named = voteEditorReducer(editing, { type: 'name', value: 'Ada B.' });
    const pruned = voteEditorReducer(named, { type: 'options', optionIds: ['o2', 'o3'] });
    expect(pruned.draftVotes).toEqual({ o2: 'no' });
    expect(pruned.name).toBe('Ada B.');
    expect(pruned.editingId).toBe('p1');
  });

  it('returns the same state when every drafted date is still in the poll', () => {
    const editing = voteEditorReducer(initialVoteEditor, { type: 'startEdit', participant: ada });
    expect(voteEditorReducer(editing, { type: 'options', optionIds: ['o1', 'o2', 'o3'] })).toBe(editing);
    expect(voteEditorReducer(initialVoteEditor, { type: 'options', optionIds: [] })).toBe(initialVoteEditor);
  });

  it('closes the editor but keeps whose row it was for the focus return', () => {
    const editing = voteEditorReducer(initialVoteEditor, { type: 'startEdit', participant: ada });
    const closed = voteEditorReducer(editing, { type: 'close' });
    expect(closed.editingId).toBeNull();
    expect(closed.returnTo).toBe('p1');
  });
});
