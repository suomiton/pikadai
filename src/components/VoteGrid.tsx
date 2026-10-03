import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { LIMITS } from '@shared/limits';
import type { EventOption, Participant } from '@shared/types';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useVoteEditor } from '../hooks/useVoteEditor';
import { api, ApiRequestError } from '../lib/api';
import { formatDateLong } from '../lib/dates';
import { computeTallies, hasAnswered, LABEL } from '../lib/votes';
import { usePoll, usePollActions } from '../state/AppStateProvider';
import { EditPanel } from './EditPanel';
import { ConfirmDialog } from './ConfirmDialog';
import { FormError } from './FormError';
import { OptionHeader } from './OptionHeader';
import { StatusAnnouncer } from './StatusAnnouncer';
import { SuggestDate } from './SuggestDate';
import { VoteEditRow } from './VoteEditRow';
import { VoteRow } from './VoteRow';

const NAME_REQUIRED = 'Please enter a name.';

type Removal = { kind: 'participant'; participant: Participant } | { kind: 'option'; option: EventOption };

/** Where focus goes once a request has finished: back to the control that opened the editor, or into the row just opened. */
type FocusTarget = 'return' | 'editor';

interface Props {
  /**
   * Everyone's rows, the tallies and the best-date highlight. False until the viewer has answered a
   * date themselves (EventPage decides): then the table holds only their own row, so what others said
   * does not sway the answer.
   */
  showAll: boolean;
}

/**
 * The participants × dates table. Owns the three mutations on rows and dates and the focus return;
 * the editing state machine is `useVoteEditor`, the rows and the panel are their own components.
 */
export function VoteGrid({ showAll }: Props) {
  const { event, me, adminToken, isAdmin } = usePoll();
  const { refresh, setIdentity } = usePollActions();
  const id = useId();
  const editor = useVoteEditor();
  const { editingId, returnTo, name: draftName, draftVotes } = editor.state;
  const { busy, error, setError, run } = useAsyncAction();
  /** Read out by the live region: vote changes, saves and removals that are otherwise silent. */
  const [status, setStatus] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<Removal | null>(null);

  const sectionRef = useRef<HTMLElement>(null);
  const tableRegionRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ seq: number; target: FocusTarget }>({ seq: 0, target: 'return' });
  const handledFocusRequest = useRef(0);

  const editing = editingId !== null;
  const isFull = event.participants.length >= LIMITS.participantsMax;
  const canSuggest = isAdmin || event.allowSuggestions;
  const mine = me ? event.participants.find((p) => p.id === me.id) : undefined;
  const rows = showAll ? event.participants : mine ? [mine] : [];

  const tallies = useMemo(() => computeTallies(event.options, event.participants), [event]);

  // A date removed while an answer is open must leave the draft too, or Save would still send it.
  const optionIds = useMemo(() => event.options.map((o) => o.id), [event.options]);
  const { syncOptions, startEdit } = editor;
  useEffect(() => {
    syncOptions(optionIds);
  }, [optionIds, syncOptions]);
  // Only once everyone is on screen: a highlight would otherwise say what others answered.
  const bestYes = showAll ? Math.max(0, ...event.options.map((o) => tallies[o.id]?.yes ?? 0)) : 0;
  const isBest = (optionId: string) => bestYes > 0 && tallies[optionId]?.yes === bestYes;

  /*
   * When the editor closes, the row or panel that had focus unmounts and focus would fall to
   * <body>. Put it back on the Edit button of the row that was open, or on the nearest thing still
   * on screen. When a row opens by itself, right after joining, the form that had focus has gone the
   * same way, so focus moves into the row, on its first date cell.
   */
  useEffect(() => {
    // Buttons are disabled while a request is in flight and cannot take focus; wait it out.
    if (focusRequest.seq === handledFocusRequest.current || busy) return;
    handledFocusRequest.current = focusRequest.seq;
    const section = sectionRef.current;
    if (!section) return;
    const editButton = (participantId: string) =>
      section.querySelector<HTMLElement>(`[data-edit-for="${participantId}"]`);
    const candidates =
      focusRequest.target === 'editor'
        ? [section.querySelector<HTMLElement>('tr.is-editing .vote-btn'), nameRef.current]
        : [returnTo ? editButton(returnTo) : null, me ? editButton(me.id) : null, tableRegionRef.current];
    candidates.find((el): el is HTMLElement => el !== null)?.focus();
  }, [focusRequest, busy, returnTo, me]);

  const requestFocus = useCallback((target: FocusTarget) => setFocusRequest((r) => ({ seq: r.seq + 1, target })), []);

  /*
   * A row that has no answers yet opens by itself, once: right after joining, and for someone who
   * joined earlier and has not answered. Cancelling leaves it closed until the page is next loaded.
   */
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!mine || hasAnswered(mine) || editingId !== null || openedFor.current === mine.id) return;
    openedFor.current = mine.id;
    startEdit(mine);
    requestFocus('editor');
  }, [mine, editingId, startEdit, requestFocus]);

  function beginEdit(p: Participant) {
    setError(null);
    startEdit(p);
  }

  function cancel() {
    editor.close();
    setError(null);
    requestFocus('return');
  }

  function toggle(option: EventOption) {
    const next = editor.toggle(option);
    setStatus(`${formatDateLong(option.date)}: ${LABEL[next ?? 'none']}`);
  }

  const editingParticipant = event.participants.find((p) => p.id === editingId);
  // One's own name is changed in the Name tile; the organiser renames other people from their rows.
  const nameEditable = editingParticipant !== undefined && editingParticipant.id !== me?.id;

  async function save() {
    if (!editingParticipant) return;
    const name = nameEditable ? draftName.trim() : editingParticipant.name;
    if (!name) {
      setError(NAME_REQUIRED);
      nameRef.current?.focus();
      return;
    }

    setStatus('Saving your answers.');
    const saved = await run(async () => {
      try {
        await api.updateParticipant(
          event.id,
          editingParticipant.id,
          { name: name, votes: draftVotes },
          { adminToken, participant: me },
        );
      } catch (err) {
        // A date was removed after this page last fetched the poll. Show the current columns, which
        // also prunes the draft, and keep the editor open so the rest can be saved on the next try.
        if (err instanceof ApiRequestError && err.code === 'unknown_option') void refresh(event.id);
        throw err;
      }
      editor.close();
      await refresh(event.id);
    });
    if (saved) {
      setStatus(
        showAll || editingParticipant.id !== me?.id
          ? 'Your answers were saved.'
          : 'Your answers were saved. The table now shows what everyone else answered.',
      );
      requestFocus('return');
    } else {
      // The editor stays open with the draft.
      setStatus('');
    }
  }

  async function remove(p: Participant) {
    const isMe = me?.id === p.id;

    const removed = await run(async () => {
      await api.deleteParticipant(event.id, p.id, { adminToken, participant: isMe ? me : null });
      if (isMe) setIdentity(event.id, null);
      editor.close();
      await refresh(event.id);
    });
    if (removed) {
      setStatus(isMe ? 'Your answers were removed.' : `${p.name} was removed from the poll.`);
      setPendingRemoval(null);
    }
  }

  async function removeOption(option: EventOption) {
    if (!adminToken) return;

    const removed = await run(async () => {
      await api.deleteOption(event.id, option.id, adminToken);
      await refresh(event.id);
    });
    if (removed) {
      setStatus(`${formatDateLong(option.date)} was removed from the poll.`);
      setPendingRemoval(null);
    }
  }

  function requestRemoval(removal: Removal) {
    if (busy) return;
    setError(null);
    setPendingRemoval(removal);
  }

  function confirmRemoval() {
    if (!pendingRemoval || busy) return;
    if (pendingRemoval.kind === 'participant') void remove(pendingRemoval.participant);
    else void removeOption(pendingRemoval.option);
  }

  const errorId = `${id}-error`;
  const nameInvalid = error === NAME_REQUIRED;
  // The one place the last failure is shown: the panel while editing, under the table otherwise. The
  // confirmation dialog shows it itself while it is open.
  const errorHost = pendingRemoval ? 'dialog' : editing ? 'panel' : 'table';

  const editRowProps = {
    options: event.options,
    isBest,
    votes: draftVotes,
    onToggle: toggle,
    nameEditable,
    name: draftName,
    onNameChange: editor.setName,
    nameInvalid,
    errorId,
    nameRef,
  };

  return (
    <section ref={sectionRef} className="card stack vote-section" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Availability</h2>
      <StatusAnnouncer message={status} />

      {me === null && isFull && <p className="hint">This poll is full.</p>}
      {!showAll && <p className="hint">Answer at least one date and save to see what others have answered.</p>}

      <div
        ref={tableRegionRef}
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Availability table, scrolls sideways"
      >
        <table className="vote-table">
          <caption className="visually-hidden">
            {showAll
              ? 'One row per participant and one column per date. The last row counts the yes and if-need-be answers for each date.'
              : 'Your row, with one column per date.'}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="name-col">
                {showAll
                  ? `${event.participants.length} ${event.participants.length === 1 ? 'answer' : 'answers'}`
                  : 'You'}
              </th>
              {event.options.map((o) => (
                <OptionHeader
                  key={o.id}
                  option={o}
                  isBest={isBest(o.id)}
                  canRemove={isAdmin}
                  disabled={busy}
                  onRemove={(option) => requestRemoval({ kind: 'option', option })}
                />
              ))}
              <th scope="col" className="actions-col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((p) =>
              editingId === p.id ? (
                <VoteEditRow key={p.id} {...editRowProps} participant={p} isMine={me?.id === p.id} />
              ) : (
                <VoteRow
                  key={p.id}
                  participant={p}
                  options={event.options}
                  isBest={isBest}
                  isMine={me?.id === p.id}
                  canEdit={(isAdmin || me?.id === p.id) && !editing}
                  disabled={busy}
                  onEdit={beginEdit}
                />
              ),
            )}

            {showAll && event.participants.length === 0 && (
              <tr className="is-empty">
                <td colSpan={event.options.length + 2}>No answers yet. Be the first.</td>
              </tr>
            )}
          </tbody>

          {showAll && (
            <tfoot>
              <tr>
                <th scope="row" className="name-col">
                  yes <span className="muted">/ if need be</span>
                </th>
                {event.options.map((o) => (
                  <td key={o.id} className={`tally${isBest(o.id) ? ' is-best' : ''}`}>
                    <strong>{tallies[o.id]?.yes ?? 0}</strong>
                    <span className="muted"> / {tallies[o.id]?.maybe ?? 0}</span>
                  </td>
                ))}
                <td className="actions-col" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {canSuggest && (
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
        />
      )}

      {errorHost === 'table' && <FormError message={error} />}
      {pendingRemoval && (
        <ConfirmDialog
          title={
            pendingRemoval.kind === 'option'
              ? 'Remove this date?'
              : me?.id === pendingRemoval.participant.id
                ? 'Remove your answers?'
                : `Remove ${pendingRemoval.participant.name}?`
          }
          description={
            pendingRemoval.kind === 'option'
              ? `${formatDateLong(pendingRemoval.option.date)} and every answer for it will be removed. This cannot be undone.`
              : me?.id === pendingRemoval.participant.id
                ? 'Your answers and comments will be removed from this poll. This cannot be undone.'
                : `${pendingRemoval.participant.name} and all their answers and comments will be removed from this poll. This cannot be undone.`
          }
          confirmLabel={pendingRemoval.kind === 'option' ? 'Remove date' : 'Remove answers'}
          busyLabel={pendingRemoval.kind === 'option' ? 'Removing date…' : 'Removing answers…'}
          busy={busy}
          error={error}
          onConfirm={confirmRemoval}
          onCancel={() => {
            setPendingRemoval(null);
            setError(null);
          }}
          returnFocusRef={tableRegionRef}
        />
      )}
    </section>
  );
}
