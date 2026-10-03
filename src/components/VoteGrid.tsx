import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { LIMITS } from '@shared/limits';
import type { EventOption, Participant } from '@shared/types';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useVoteEditor } from '../hooks/useVoteEditor';
import { api } from '../lib/api';
import { formatDateLong } from '../lib/dates';
import { computeTallies, LABEL } from '../lib/votes';
import { usePoll, usePollActions } from '../state/AppStateProvider';
import { EditPanel } from './EditPanel';
import { ConfirmDialog } from './ConfirmDialog';
import { FormError } from './FormError';
import { OptionHeader } from './OptionHeader';
import { StatusAnnouncer } from './StatusAnnouncer';
import { SuggestDate } from './SuggestDate';
import { VoteEditRow } from './VoteEditRow';
import { VoteRow } from './VoteRow';

const NICKNAME_REQUIRED = 'Please enter a nickname.';

type Removal = { kind: 'participant'; participant: Participant } | { kind: 'option'; option: EventOption };

/**
 * The participants × dates table. Owns the three mutations and the focus return; the editing
 * state machine is `useVoteEditor`, the rows and the panel are their own components.
 */
export function VoteGrid() {
  const { event, me, adminToken, isAdmin } = usePoll();
  const { refresh, setIdentity } = usePollActions();
  const id = useId();
  const editor = useVoteEditor();
  const { editing, opener, nickname, draftVotes, turnstileToken } = editor.state;
  const { busy, error, setError, run } = useAsyncAction();
  /** Read out by the live region: vote changes, saves and removals that are otherwise silent. */
  const [status, setStatus] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<Removal | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);

  const sectionRef = useRef<HTMLElement>(null);
  const tableRegionRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const handledFocusRequest = useRef(0);

  const hasAnswered = me !== null && event.participants.some((p) => p.id === me.id);
  const isFull = event.participants.length >= LIMITS.participantsMax;
  const editingId = editing?.kind === 'existing' ? editing.participantId : null;
  const canAnswer = editing === null && !hasAnswered && !isFull;
  const canSuggest = isAdmin || event.allowSuggestions;

  const tallies = useMemo(() => computeTallies(event.options, event.participants), [event]);
  const bestYes = Math.max(0, ...event.options.map((o) => tallies[o.id]?.yes ?? 0));
  const isBest = (optionId: string) => bestYes > 0 && tallies[optionId]?.yes === bestYes;

  /*
   * When the editor closes, the row or panel that had focus unmounts and focus would fall to
   * <body>. Put it back on the control that opened the editor, or on the nearest thing still on
   * screen: the Add button disappears once you have answered, and an Edit button goes with its row.
   */
  useEffect(() => {
    // Buttons are disabled while a request is in flight and cannot take focus; wait it out.
    if (focusRequest === handledFocusRequest.current || busy) return;
    handledFocusRequest.current = focusRequest;
    const section = sectionRef.current;
    if (!section) return;
    const editButton = (participantId: string) =>
      section.querySelector<HTMLElement>(`[data-edit-for="${participantId}"]`);
    const candidates = [
      opener?.kind === 'edit' ? editButton(opener.participantId) : null,
      me ? editButton(me.id) : null,
      addButtonRef.current,
      tableRegionRef.current,
    ];
    candidates.find((el): el is HTMLElement => el !== null)?.focus();
  }, [focusRequest, busy, opener, me]);

  const returnFocus = () => setFocusRequest((n) => n + 1);

  function startNew() {
    setError(null);
    editor.startNew();
  }

  function startEdit(p: Participant) {
    setError(null);
    editor.startEdit(p);
  }

  function cancel() {
    editor.close();
    setError(null);
    returnFocus();
  }

  function toggle(option: EventOption) {
    const next = editor.toggle(option);
    setStatus(`${formatDateLong(option.date)}: ${LABEL[next ?? 'none']}`);
  }

  async function save() {
    if (!editing) return;
    const name = nickname.trim();
    if (!name) {
      setError(NICKNAME_REQUIRED);
      nicknameRef.current?.focus();
      return;
    }
    if (editing.kind === 'new' && !turnstileToken) {
      setError('Please complete the verification first.');
      return;
    }

    setStatus('Saving your answers.');
    const saved = await run(async () => {
      if (editing.kind === 'new') {
        const res = await api.addParticipant(event.id, {
          nickname: name,
          votes: draftVotes,
          turnstileToken: turnstileToken!,
        });
        setIdentity(event.id, { id: res.id, token: res.editToken });
      } else {
        await api.updateParticipant(
          event.id,
          editing.participantId,
          { nickname: name, votes: draftVotes },
          { adminToken, participant: me },
        );
      }
      editor.close();
      await refresh(event.id);
    });
    if (saved) {
      setStatus('Your answers were saved.');
      returnFocus();
    } else {
      // The editor stays open with the draft; a Turnstile token is single-use, so get a fresh one.
      setStatus('');
      turnstileRef.current?.reset();
      editor.setTurnstileToken(null);
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
  const editingParticipant =
    editing?.kind === 'existing' ? event.participants.find((p) => p.id === editing.participantId) : undefined;

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
                  canEdit={(isAdmin || me?.id === p.id) && editing === null}
                  disabled={busy}
                  onEdit={startEdit}
                />
              ),
            )}

            {editing?.kind === 'new' && (
              <VoteEditRow {...editRowProps} isMine focusOnMount placeholder="Your nickname" />
            )}

            {event.participants.length === 0 && editing === null && (
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

      {editing === null && !hasAnswered && isFull && <p className="hint">This poll is full.</p>}

      {(canAnswer || canSuggest) && (
        <div className="btn-row">
          {canAnswer && (
            <button ref={addButtonRef} type="button" className="btn btn-primary" onClick={startNew} disabled={busy}>
              Add your availability
            </button>
          )}
          {canSuggest && <SuggestDate />}
        </div>
      )}

      {editing !== null && (
        <EditPanel
          isNew={editing.kind === 'new'}
          busy={busy}
          canSave={editing.kind !== 'new' || turnstileToken !== null}
          error={pendingRemoval ? null : error}
          errorId={errorId}
          turnstileRef={turnstileRef}
          onToken={editor.setTurnstileToken}
          onSave={save}
          onCancel={cancel}
          onRemove={
            editingParticipant
              ? () => requestRemoval({ kind: 'participant', participant: editingParticipant })
              : undefined
          }
        />
      )}

      {editing === null && !pendingRemoval && <FormError message={error} />}
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
                ? 'Your answers will be removed from this poll. This cannot be undone.'
                : `${pendingRemoval.participant.nickname} and all their answers will be removed from this poll. This cannot be undone.`
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
