import { useId } from 'react';
import { NAME_REQUIRED, useVoteGrid } from '../hooks/useVoteGrid';
import { usePoll } from '../state/AppStateProvider';
import { EditPanel } from './EditPanel';
import { FormError } from './FormError';
import { StatusAnnouncer } from './StatusAnnouncer';
import { SuggestDate } from './SuggestDate';
import { VoteRemovalDialog } from './VoteRemovalDialog';
import { VoteTable } from './VoteTable';

type VoteGridController = ReturnType<typeof useVoteGrid>;

const VoteEditorPanel = ({ grid, errorId }: { grid: VoteGridController; errorId: string }) => {
  const { action, saving, removal, cancel, errorHost } = grid;
  const { editingParticipant } = saving;
  if (!editingParticipant) return null;
  return (
    <EditPanel
      busy={action.busy}
      error={errorHost === 'panel' ? action.error : null}
      errorId={errorId}
      onSave={saving.save}
      onCancel={cancel}
      onRemove={() => removal.requestRemoval({ kind: 'participant', participant: editingParticipant })}
    />
  );
};

/** The availability section composes the table, editing controls and removal confirmation. */
export function VoteGrid({ showAll }: { showAll: boolean }) {
  const id = useId();
  const { me } = usePoll();
  const grid = useVoteGrid(showAll);
  const { editor, action, focus, saving, removal, status, tallies, isBest, beginEdit, toggle } = grid;
  const { editingId, name, draftVotes } = editor.state;
  const { busy, error } = action;
  const { pendingRemoval, requestRemoval, confirmRemoval, cancelRemoval } = removal;
  const { sectionRef, tableRegionRef, nameRef } = focus;
  const errorId = `${id}-error`;
  const editRowProps = {
    votes: draftVotes,
    onToggle: toggle,
    nameEditable: saving.nameEditable,
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
      {!showAll && <p className="hint">Answer at least one date and save to see what others have answered.</p>}
      <VoteTable
        ref={tableRegionRef}
        showAll={showAll}
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
      <VoteEditorPanel grid={grid} errorId={errorId} />
      {grid.errorHost === 'table' && <FormError message={error} />}
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
