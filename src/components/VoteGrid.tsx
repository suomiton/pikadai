import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LIMITS } from '@shared/limits';
import type { EventOption, Participant } from '@shared/types';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useVoteEditor } from '../hooks/useVoteEditor';
import { api, ApiRequestError } from '../lib/api';
import { formatDateLong } from '../lib/dates';
import type { ParticipantIdentity } from '../lib/storage';
import { computeTallies, LABEL } from '../lib/votes';
import { usePoll, usePollActions } from '../state/AppStateProvider';
import { EditPanel } from './EditPanel';
import { ConfirmDialog } from './ConfirmDialog';
import { FormError } from './FormError';
import { JoinForm } from './JoinForm';
import { OptionHeader } from './OptionHeader';
import { StatusAnnouncer } from './StatusAnnouncer';
import { SuggestDate } from './SuggestDate';
import { VoteEditRow } from './VoteEditRow';
import { VoteRow } from './VoteRow';

const NICKNAME_REQUIRED = 'Please enter a nickname.';

type Removal = { kind: 'participant'; participant: Participant } | { kind: 'option'; option: EventOption };

/** Where focus goes once a request has finished: back to the control that opened the editor, or into the row just opened. */
type FocusTarget = 'return' | 'editor';

/**
 * The participants × dates table. Owns joining the poll, the three mutations on rows and dates, and
 * the focus return; the editing state machine is `useVoteEditor`, the rows, the join form and the
 * panel are their own components.
 */
export function VoteGrid() {
  const { event, me, adminToken, isAdmin } = usePoll();
  const { refresh, setIdentity } = usePollActions();
  const id = useId();
  const editor = useVoteEditor();
  const { editingId, returnTo, nickname, draftVotes } = editor.state;
  const { busy, error, setError, run } = useAsyncAction();
  /** Read out by the live region: vote changes, saves and removals that are otherwise silent. */
  const [status, setStatus] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<Removal | null>(null);

  const sectionRef = useRef<HTMLElement>(null);
  const tableRegionRef = useRef<HTMLDivElement>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ seq: number; target: FocusTarget }>({ seq: 0, target: 'return' });
  const handledFocusRequest = useRef(0);

  const editing = editingId !== null;
  const isFull = event.participants.length >= LIMITS.participantsMax;
  /** Nobody in this browser has joined yet: the nickname step comes before the dates. */
  const showJoin = me === null && !isFull;
  const canSuggest = isAdmin || event.allowSuggestions;

  const tallies = useMemo(() => computeTallies(event.options, event.participants), [event]);

  // A date removed while an answer is open must leave the draft too, or Save would still send it.
  const optionIds = useMemo(() => event.options.map((o) => o.id), [event.options]);
  const { syncOptions } = editor;
  useEffect(() => {
    syncOptions(optionIds);
  }, [optionIds, syncOptions]);
  const bestYes = Math.max(0, ...event.options.map((o) => tallies[o.id]?.yes ?? 0));
  const isBest = (optionId: string) => bestYes > 0 && tallies[optionId]?.yes === bestYes;

  /*
   * When the editor closes, the row or panel that had focus unmounts and focus would fall to
   * <body>. Put it back on the Edit button of the row that was open, or on the nearest thing still
   * on screen. When the editor opens right after joining, the join form has gone the same way, so
   * focus moves into the new row, on its first date cell.
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
        ? [section.querySelector<HTMLElement>('tr.is-editing .vote-btn'), nicknameRef.current]
        : [returnTo ? editButton(returnTo) : null, me ? editButton(me.id) : null, tableRegionRef.current];
    candidates.find((el): el is HTMLElement => el !== null)?.focus();
  }, [focusRequest, busy, returnTo, me]);

  const requestFocus = (target: FocusTarget) => setFocusRequest((r) => ({ seq: r.seq + 1, target }));

  function startEdit(p: Participant) {
    setError(null);
    editor.startEdit(p);
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

  /**
   * Take the nickname: create this browser's participant with no answers yet, then open that row so
   * the next tap is on a date. Comments use the same identity.
   */
  async function join(name: string, turnstileToken: string): Promise<boolean> {
    setStatus('Joining the poll.');
    const outcome: { me?: ParticipantIdentity; onScreen?: boolean } = {};
    const joined = await run(async () => {
      const res = await api.addParticipant(event.id, { nickname: name, votes: {}, turnstileToken });
      outcome.me = { id: res.id, token: res.editToken };
      setIdentity(event.id, outcome.me);
      // The row has to be on screen before it can be edited; a failed refresh shows its own retry.
      outcome.onScreen = await refresh(event.id);
    });
    if (!joined || !outcome.me) {
      setStatus('');
      return false;
    }
    if (outcome.onScreen) {
      editor.startEdit({ id: outcome.me.id, nickname: name, votes: {}, createdAt: Date.now() });
      requestFocus('editor');
      setStatus(`You joined as ${name}. Tap a date to add your availability.`);
    } else {
      setStatus(`You joined as ${name}.`);
    }
    return true;
  }

  async function save() {
    if (editingId === null) return;
    const name = nickname.trim();
    if (!name) {
      setError(NICKNAME_REQUIRED);
      nicknameRef.current?.focus();
      return;
    }

    setStatus('Saving your answers.');
    const saved = await run(async () => {
      try {
        await api.updateParticipant(
          event.id,
          editingId,
          { nickname: name, votes: draftVotes },
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
      setStatus('Your answers were saved.');
      requestFocus('return');
    } else {
      // The editor stays open with the draft.
      setStatus('');
    }
  }

  async function remove(p: Participant) {
    const mine = me?.id === p.id;

    const removed = await run(async () => {
      await api.deleteParticipant(event.id, p.id, { adminToken, participant: mine ? me : null });
      if (mine) setIdentity(event.id, null);
      editor.close();
      await refresh(event.id);
    });
    if (removed) {
      setStatus(mine ? 'Your answers were removed.' : `${p.nickname} was removed from the poll.`);
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
  const nicknameInvalid = error === NICKNAME_REQUIRED;
  const editingParticipant = event.participants.find((p) => p.id === editingId);
  // The one place the last failure is shown: the panel while editing, the join form before joining,
  // and under the table otherwise. The confirmation dialog shows it itself while it is open.
  const errorHost = pendingRemoval ? 'dialog' : editing ? 'panel' : showJoin ? 'join' : 'table';

  const editRowProps = {
    options: event.options,
    isBest,
    votes: draftVotes,
    onToggle: toggle,
    nickname,
    onNicknameChange: editor.setNickname,
    nicknameInvalid,
    errorId,
    nicknameRef,
  };

  return (
    <section ref={sectionRef} className="card stack vote-section" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Availability</h2>
      <StatusAnnouncer message={status} />

      {showJoin && <JoinForm busy={busy} error={errorHost === 'join' ? error : null} onJoin={join} />}
      {me === null && isFull && <p className="hint">This poll is full.</p>}

      <div
        ref={tableRegionRef}
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Availability table, scrolls sideways"
      >
        <table className="vote-table">
          <caption className="visually-hidden">
            One row per participant and one column per date. The last row counts the yes and if-need-be answers for each
            date.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="name-col">
                {event.participants.length} {event.participants.length === 1 ? 'answer' : 'answers'}
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
            {event.participants.map((p) =>
              editingId === p.id ? (
                <VoteEditRow key={p.id} {...editRowProps} isMine={me?.id === p.id} />
              ) : (
                <VoteRow
                  key={p.id}
                  participant={p}
                  options={event.options}
                  isBest={isBest}
                  isMine={me?.id === p.id}
                  canEdit={(isAdmin || me?.id === p.id) && !editing}
                  disabled={busy}
                  onEdit={startEdit}
                />
              ),
            )}

            {event.participants.length === 0 && (
              <tr className="is-empty">
                <td colSpan={event.options.length + 2}>No answers yet. Be the first.</td>
              </tr>
            )}
          </tbody>

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
                : `Remove ${pendingRemoval.participant.nickname}?`
          }
          description={
            pendingRemoval.kind === 'option'
              ? `${formatDateLong(pendingRemoval.option.date)} and every answer for it will be removed. This cannot be undone.`
              : me?.id === pendingRemoval.participant.id
                ? 'Your answers and comments will be removed from this poll. This cannot be undone.'
                : `${pendingRemoval.participant.nickname} and all their answers and comments will be removed from this poll. This cannot be undone.`
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
