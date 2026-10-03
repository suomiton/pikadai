import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { LIMITS } from '@shared/limits';
import type { Answer, EventOption, Participant } from '@shared/types';
import { api } from '../lib/api';
import { formatDate, formatDateLong } from '../lib/dates';
import { describeError } from '../lib/errors';
import { computeTallies, cycle } from '../lib/votes';
import { usePoll, usePollActions } from '../state/AppStateProvider';
import { TurnstileField } from './TurnstileField';

type Cell = Answer | 'none';
type Editing = { kind: 'new' } | { kind: 'existing'; participantId: string } | null;
/** Which control opened the editor, so focus can go back to it when the editor closes. */
type Opener = { kind: 'add' } | { kind: 'edit'; participantId: string };

const GLYPH: Record<Cell, string> = { yes: '✓', maybe: '~', no: '✕', none: '·' };
const LABEL: Record<Cell, string> = { yes: 'Yes', maybe: 'If need be', no: 'No', none: 'No answer' };
const NICKNAME_REQUIRED = 'Please enter a nickname.';

export function VoteGrid() {
  const { event, me, adminToken } = usePoll();
  const { refresh, setIdentity } = usePollActions();
  const isAdmin = event.viewer.isAdmin;
  const id = useId();
  const [editing, setEditing] = useState<Editing>(null);
  const [nickname, setNickname] = useState('');
  const [draftVotes, setDraftVotes] = useState<Record<string, Answer>>({});
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Read out by the live region: vote changes, saves and removals that are otherwise silent. */
  const [status, setStatus] = useState('');

  const sectionRef = useRef<HTMLElement>(null);
  const tableRegionRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<Opener | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const handledFocusRequest = useRef(0);

  const hasAnswered = me !== null && event.participants.some((p) => p.id === me.id);
  const isFull = event.participants.length >= LIMITS.participantsMax;
  const editingId = editing?.kind === 'existing' ? editing.participantId : null;

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
    const opener = openerRef.current;
    const candidates = [
      opener?.kind === 'edit' ? editButton(opener.participantId) : null,
      me ? editButton(me.id) : null,
      addButtonRef.current,
      tableRegionRef.current,
    ];
    candidates.find((el): el is HTMLElement => el !== null)?.focus();
  }, [focusRequest, busy]);

  const returnFocus = () => setFocusRequest((n) => n + 1);

  function startNew() {
    openerRef.current = { kind: 'add' };
    setNickname('');
    setDraftVotes({});
    setError(null);
    setEditing({ kind: 'new' });
  }

  function startEdit(p: Participant) {
    openerRef.current = { kind: 'edit', participantId: p.id };
    setNickname(p.nickname);
    setDraftVotes({ ...p.votes });
    setError(null);
    setEditing({ kind: 'existing', participantId: p.id });
  }

  function cancel() {
    setEditing(null);
    setError(null);
    setTurnstileToken(null);
    returnFocus();
  }

  function toggle(option: EventOption) {
    const next = cycle(draftVotes[option.id]);
    setDraftVotes((votes) => {
      const copy = { ...votes };
      if (next === undefined) delete copy[option.id];
      else copy[option.id] = next;
      return copy;
    });
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

    setBusy(true);
    setError(null);
    setStatus('Saving your answers.');
    try {
      if (editing.kind === 'new') {
        const res = await api.addParticipant(event.id, {
          nickname: name,
          votes: draftVotes,
          turnstileToken: turnstileToken!,
        });
        const identity = { id: res.id, token: res.editToken };
        setIdentity(identity);
      } else {
        await api.updateParticipant(
          event.id,
          editing.participantId,
          { nickname: name, votes: draftVotes },
          { adminToken, participant: me },
        );
      }
      setEditing(null);
      setTurnstileToken(null);
      await refresh();
      setStatus('Your answers were saved.');
      returnFocus();
    } catch (err) {
      setError(describeError(err));
      setStatus('');
      turnstileRef.current?.reset();
      setTurnstileToken(null);
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Participant) {
    const mine = me?.id === p.id;
    const question = mine ? 'Remove your answers from this poll?' : `Remove ${p.nickname} from this poll?`;
    if (!window.confirm(question)) return;

    setBusy(true);
    setError(null);
    try {
      await api.deleteParticipant(event.id, p.id, { adminToken, participant: mine ? me : null });
      if (mine) {
        setIdentity(null);
      }
      setEditing(null);
      await refresh();
      setStatus(mine ? 'Your answers were removed.' : `${p.nickname} was removed from the poll.`);
      returnFocus();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeOption(option: EventOption) {
    if (!adminToken) return;
    if (!window.confirm('Remove this date and every answer for it?')) return;

    setBusy(true);
    setError(null);
    try {
      await api.deleteOption(event.id, option.id, adminToken);
      await refresh();
      setStatus(`${formatDateLong(option.date)} was removed from the poll.`);
      tableRegionRef.current?.focus(); // the button that had focus went with its column
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  function renderCells(votes: Record<string, Answer>, interactive: boolean) {
    return event.options.map((o) => {
      const cell: Cell = votes[o.id] ?? 'none';
      const className = `vote-cell is-${cell}${isBest(o.id) ? ' is-best' : ''}`;
      return (
        <td key={o.id} className={className}>
          {interactive ? (
            <button
              type="button"
              className="vote-btn"
              onClick={() => toggle(o)}
              aria-label={`${formatDateLong(o.date)}: ${LABEL[cell]}`}
              title={LABEL[cell]}
            >
              {GLYPH[cell]}
            </button>
          ) : (
            <span className="vote-glyph" role="img" aria-label={LABEL[cell]} title={LABEL[cell]}>
              {GLYPH[cell]}
            </span>
          )}
        </td>
      );
    });
  }

  const errorId = `${id}-error`;
  const nicknameInvalid = error === NICKNAME_REQUIRED;

  function renderNicknameInput(extra: { autoFocus?: boolean; placeholder?: string } = {}) {
    return (
      <input
        ref={nicknameRef}
        className="input input-sm"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        maxLength={LIMITS.nicknameMax}
        aria-label="Nickname"
        aria-invalid={nicknameInvalid || undefined}
        aria-describedby={nicknameInvalid ? errorId : undefined}
        {...extra}
      />
    );
  }

  const editingParticipant =
    editing?.kind === 'existing' ? event.participants.find((p) => p.id === editing.participantId) : undefined;

  return (
    <section ref={sectionRef} className="card stack vote-section" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Availability</h2>
      <p className="visually-hidden" role="status">
        {status}
      </p>
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
                <th key={o.id} scope="col" className={`option-col${isBest(o.id) ? ' is-best' : ''}`}>
                  <span className="opt-weekday">{formatDate(o.date, { weekday: 'short' })}</span>
                  <span className="opt-day">{formatDate(o.date, { day: 'numeric', month: 'short' })}</span>
                  <span className="opt-year">{o.date.slice(0, 4)}</span>
                  {o.suggestedBy && (
                    <span className="opt-tag" title="Suggested by a participant">
                      suggested
                    </span>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => removeOption(o)}
                      disabled={busy}
                      aria-label={`Remove ${formatDateLong(o.date)}`}
                      title="Remove this date"
                    >
                      ×
                    </button>
                  )}
                </th>
              ))}
              <th scope="col" className="actions-col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {event.participants.map((p) => {
              const isMine = me?.id === p.id;
              const isEditingRow = editingId === p.id;
              const rowClass = [isMine && 'is-me', isEditingRow && 'is-editing'].filter(Boolean).join(' ');
              return (
                <tr key={p.id} className={rowClass}>
                  <th scope="row" className="name-col">
                    {isEditingRow ? (
                      renderNicknameInput()
                    ) : (
                      <>
                        <span className="participant-name">{p.nickname}</span>
                        {isMine && <span className="tag">you</span>}
                      </>
                    )}
                  </th>
                  {renderCells(isEditingRow ? draftVotes : p.votes, isEditingRow)}
                  <td className="actions-col">
                    {(isAdmin || isMine) && editing === null && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        data-edit-for={p.id}
                        onClick={() => startEdit(p)}
                        disabled={busy}
                        aria-label={isMine ? 'Edit your answers' : `Edit ${p.nickname}`}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}

            {editing?.kind === 'new' && (
              <tr className="is-me is-editing">
                <th scope="row" className="name-col">
                  {renderNicknameInput({ autoFocus: true, placeholder: 'Your nickname' })}
                </th>
                {renderCells(draftVotes, true)}
                <td className="actions-col" />
              </tr>
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

      {editing === null &&
        !hasAnswered &&
        (isFull ? (
          <p className="hint">This poll is full.</p>
        ) : (
          <div>
            <button ref={addButtonRef} type="button" className="btn btn-primary" onClick={startNew} disabled={busy}>
              Add your availability
            </button>
          </div>
        ))}

      {editing !== null && (
        <div className="edit-panel stack">
          <p className="hint">
            Tap a cell to cycle through <span aria-hidden="true">✓ </span>yes, <span aria-hidden="true">~ </span>
            if need be, <span aria-hidden="true">✕ </span>no, and <span aria-hidden="true">· </span>no answer.
          </p>
          {editing.kind === 'new' && <TurnstileField action="answer" ref={turnstileRef} onToken={setTurnstileToken} />}
          {error && (
            <p id={errorId} className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={busy || (editing.kind === 'new' && !turnstileToken)}
            >
              {busy ? 'Saving' : 'Save'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={cancel} disabled={busy}>
              Cancel
            </button>
            {editingParticipant && (
              <button
                type="button"
                className="btn btn-ghost danger"
                onClick={() => remove(editingParticipant)}
                disabled={busy}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}

      {editing === null && error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
