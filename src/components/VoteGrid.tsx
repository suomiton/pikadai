import { useId } from 'react';
import { NAME_REQUIRED, useVoteGrid } from '../hooks/useVoteGrid';
import { usePoll } from '../state/AppStateProvider';
import { EditPanel } from './EditPanel';
import { FormError } from './FormError';
import { StatusAnnouncer } from './StatusAnnouncer';
import { SuggestDate } from './SuggestDate';
import { VoteRemovalDialog } from './VoteRemovalDialog';
import { VoteTable } from './VoteTable';

/** The availability section composes the table, editing controls and removal confirmation. */
export function VoteGrid({ showAll }: { showAll: boolean }) {
  const id = useId();
  const { event, me, isAdmin } = usePoll();
  const grid = useVoteGrid(showAll);
  const {
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
    toggle,
    rows,
    cancel,
    errorHost,
  } = grid;
  const { editingParticipant, save, nameEditable } = saving;
  const { editingId, name, draftVotes } = editor.state;
  const { busy, error } = action;
  const { pendingRemoval, requestRemoval, confirmRemoval, cancelRemoval } = removal;
  const { sectionRef, tableRegionRef, nameRef } = focus;
  const errorId = `${id}-error`;
  const editRowProps = {
    options: event.options,
    isBest,
    votes: draftVotes,
    onToggle: toggle,
    nameEditable,
    name,
    onNameChange: editor.setName,
    nameInvalid: error === NAME_REQUIRED,
    errorId,
    nameRef,
  };
  return (
    <section ref={sectionRef} className="card stack vote-section" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Availability</h2>
      <StatusAnnouncer message={status} />
      {me === null && grid.isFull && <p className="hint">This poll is full.</p>}
      {!showAll && !grid.isDisabled && (
        <p className="hint">Answer at least one date and save to see what others have answered.</p>
      )}
      <VoteTable
        ref={tableRegionRef}
        showAll={showAll}
        rows={rows}
        editingId={editingId}
        editRowProps={editRowProps}
        busy={busy}
        isBest={isBest}
        tallies={tallies}
        onEdit={beginEdit}
        onRemoveOption={(option) => requestRemoval({ kind: 'option', option })}
      />
      {grid.canSuggest && (
        <div className="btn-row">
          <SuggestDate />
        </div>
      )}
      {editingParticipant && (
        <EditPanel
          busy={busy}
          error={errorHost === 'panel' ? error : null}
          errorId={errorId}
          onSave={save}
          onCancel={cancel}
          onRemove={() => requestRemoval({ kind: 'participant', participant: editingParticipant })}
          disabling={
            isAdmin && editingParticipant.id !== me?.id
              ? {
                  disabled: editingParticipant.isDisabled,
                  onToggle: () => void setDisabled(editingParticipant, !editingParticipant.isDisabled),
                }
              : undefined
          }
        />
      )}
      {errorHost === 'table' && <FormError message={error} />}
      {pendingRemoval && (
        <VoteRemovalDialog
          removal={pendingRemoval}
          busy={busy}
          error={error}
          onConfirm={confirmRemoval}
          onCancel={cancelRemoval}
          returnFocusRef={tableRegionRef}
        />
      )}
    </section>
  );
}
