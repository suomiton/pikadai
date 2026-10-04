import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventOption, Participant } from '@shared/types';
import { api, ApiRequestError } from '../lib/api';
import { formatDateLong } from '../lib/dates';
import { computeTallies, hasAnswered, LABEL } from '../lib/votes';
import { usePoll, usePollActions } from '../state/AppStateProvider';
import type { AsyncAction } from './useAsyncAction';
import { useParticipantDisabling } from './useParticipantDisabling';
import { usePollAction } from './usePollAction';
import { useVoteEditor, type VoteEditor } from './useVoteEditor';
import { useVoteEditorFocus, type VoteEditorFocus } from './useVoteEditorFocus';
import { useVoteRemoval } from './useVoteRemoval';

export const NAME_REQUIRED = 'Please enter a name.';

type ErrorHost = 'dialog' | 'panel' | 'table';

const useVoteSaving = (
  editor: VoteEditor,
  action: AsyncAction,
  focus: VoteEditorFocus,
  setStatus: (value: string) => void,
  showAll: boolean,
) => {
  const { event, me, adminToken } = usePoll();
  const { refresh } = usePollActions();
  const { editingId, name: draftName, draftVotes } = editor.state;
  const { run, setError } = action;
  const editingParticipant = event.participants.find((p) => p.id === editingId);
  const nameEditable = editingParticipant !== undefined && editingParticipant.id !== me?.id;

  const validate = () => {
    if (!editingParticipant) return null;
    // Own saves carry only votes so a concurrent rename from the Name tile is preserved.
    const name = nameEditable ? draftName.trim() : undefined;
    if (nameEditable && !name) {
      setError(NAME_REQUIRED);
      focus.nameRef.current?.focus();
      return null;
    }
    return { participant: editingParticipant, name };
  };

  const persist = async (participant: Participant, name: string | undefined) => {
    try {
      await api.updateParticipant(
        event.id,
        participant.id,
        { name, votes: draftVotes },
        { adminToken, participant: me },
      );
    } catch (err) {
      // Refresh removed dates and prune stale votes, keeping the editor open for another attempt.
      if (err instanceof ApiRequestError && err.code === 'unknown_option') void refresh(event.id);
      throw err;
    }
  };

  const save = async () => {
    const input = validate();
    if (!input) return;
    const isMine = input.participant.id === me?.id;
    const name = input.name ?? input.participant.name;
    let tableRevealed = false;
    setStatus(isMine ? 'Saving your answers.' : `Saving ${name}'s answers.`);
    const saved = await run(async () => {
      await persist(input.participant, input.name);
      editor.close();
      const refreshed = await refresh(event.id);
      tableRevealed = refreshed && !showAll && hasAnswered({ votes: draftVotes });
    });
    if (saved) {
      setStatus(
        !isMine
          ? `${name}'s answers were saved.`
          : tableRevealed
            ? 'Your answers were saved. The table now shows what everyone else answered.'
            : 'Your answers were saved.',
      );
      focus.requestFocus('return');
    } else {
      setStatus('');
    }
  };

  return { save, editingParticipant, nameEditable };
};

/** Coordinates the editor, mutations and announcements without rendering the table. */
export function useVoteGrid(showAll: boolean) {
  const { event, me, isAdmin, resultsOnly } = usePoll();
  const editor = useVoteEditor();
  const action = usePollAction();
  const [status, setStatus] = useState('');
  const focus = useVoteEditorFocus(editor.state.returnTo, me?.id, action.busy);
  const saving = useVoteSaving(editor, action, focus, setStatus, showAll);
  const removal = useVoteRemoval(editor, action, setStatus);
  const setDisabled = useParticipantDisabling(editor, action, focus, setStatus);
  const { editingId } = editor.state;
  const mine = me ? event.participants.find((p) => p.id === me.id) : undefined;

  const optionIds = useMemo(() => event.options.map((o) => o.id), [event.options]);
  const { syncOptions, startEdit, close } = editor;
  useEffect(() => {
    syncOptions(optionIds);
  }, [optionIds, syncOptions]);

  // Open an unanswered row once per page load, including immediately after joining.
  const openedFor = useRef<string | null>(null);
  const { requestFocus } = focus;
  const { editingParticipant } = saving;
  const { setError } = action;
  useEffect(() => {
    if (editingId === null || editingParticipant) return;
    close();
    setError(null);
    requestFocus('return');
  }, [editingId, editingParticipant, close, setError, requestFocus]);

  useEffect(() => {
    if (!mine || mine.isDisabled || hasAnswered(mine) || editingId !== null || openedFor.current === mine.id) return;
    openedFor.current = mine.id;
    startEdit(mine);
    requestFocus('editor');
  }, [mine, editingId, startEdit, requestFocus]);

  const tallies = useMemo(() => computeTallies(event.options, event.participants), [event]);
  const bestYes = showAll ? Math.max(0, ...event.options.map((o) => tallies[o.id]?.yes ?? 0)) : 0;
  const isBest = (optionId: string) => bestYes > 0 && tallies[optionId]?.yes === bestYes;

  const beginEdit = (participant: Participant) => {
    action.setError(null);
    startEdit(participant);
  };
  const cancel = () => {
    editor.close();
    action.setError(null);
    requestFocus('return');
  };
  const toggle = (option: EventOption) => {
    const next = editor.toggle(option);
    setStatus(`${formatDateLong(option.date)}: ${LABEL[next ?? 'none']}`);
  };
  const rows = showAll ? event.participants : mine ? [mine] : [];
  const errorHost: ErrorHost = removal.pendingRemoval ? 'dialog' : editingId !== null ? 'panel' : 'table';

  return {
    editor,
    action,
    focus,
    saving,
    removal,
    setDisabled,
    status,
    tallies,
    isBest,
    beginEdit,
    cancel,
    toggle,
    rows,
    /** The viewer's own row is disabled: they can no longer answer. */
    isDisabled: mine?.isDisabled ?? false,
    isFull: event.isFull,
    canSuggest: isAdmin || (event.allowSuggestions && !mine?.isDisabled && !resultsOnly),
    errorHost,
  };
}
