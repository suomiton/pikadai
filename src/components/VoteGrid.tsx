import { useMemo, useRef, useState } from 'react';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { LIMITS } from '@shared/limits';
import type { Answer, EventView, Participant } from '@shared/types';
import { api } from '../lib/api';
import { formatDate } from '../lib/dates';
import { describeError } from '../lib/errors';
import { storage, type ParticipantIdentity } from '../lib/storage';
import { TurnstileField } from './TurnstileField';

type Cell = Answer | 'none';
type Editing = { kind: 'new' } | { kind: 'existing'; participantId: string } | null;

const GLYPH: Record<Cell, string> = { yes: '✓', maybe: '~', no: '✕', none: '·' };
const LABEL: Record<Cell, string> = { yes: 'Yes', maybe: 'If need be', no: 'No', none: 'No answer' };

function cycle(answer: Answer | undefined): Answer | undefined {
  switch (answer) {
    case undefined:
      return 'yes';
    case 'yes':
      return 'maybe';
    case 'maybe':
      return 'no';
    case 'no':
      return undefined;
  }
}

interface Props {
  event: EventView;
  me: ParticipantIdentity | null;
  adminToken: string | null;
  onChanged: () => Promise<void>;
  onIdentityChange: (identity: ParticipantIdentity | null) => void;
}

export function VoteGrid({ event, me, adminToken, onChanged, onIdentityChange }: Props) {
  const isAdmin = event.viewer.isAdmin;
  const [editing, setEditing] = useState<Editing>(null);
  const [nickname, setNickname] = useState('');
  const [draftVotes, setDraftVotes] = useState<Record<string, Answer>>({});
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAnswered = me !== null && event.participants.some((p) => p.id === me.id);
  const isFull = event.participants.length >= LIMITS.participantsMax;
  const editingId = editing?.kind === 'existing' ? editing.participantId : null;

  const tallies = useMemo(() => {
    const t: Record<string, { yes: number; maybe: number }> = {};
    for (const o of event.options) t[o.id] = { yes: 0, maybe: 0 };
    for (const p of event.participants) {
      for (const [optionId, answer] of Object.entries(p.votes)) {
        const bucket = t[optionId];
        if (!bucket) continue;
        if (answer === 'yes') bucket.yes++;
        else if (answer === 'maybe') bucket.maybe++;
      }
    }
    return t;
  }, [event]);

  const bestYes = Math.max(0, ...event.options.map((o) => tallies[o.id]?.yes ?? 0));
  const isBest = (optionId: string) => bestYes > 0 && tallies[optionId]?.yes === bestYes;

  function startNew() {
    setNickname('');
    setDraftVotes({});
    setError(null);
    setEditing({ kind: 'new' });
  }

  function startEdit(p: Participant) {
    setNickname(p.nickname);
    setDraftVotes({ ...p.votes });
    setError(null);
    setEditing({ kind: 'existing', participantId: p.id });
  }

  function cancel() {
    setEditing(null);
    setError(null);
    setTurnstileToken(null);
  }

  function toggle(optionId: string) {
    setDraftVotes((votes) => {
      const next = cycle(votes[optionId]);
      const copy = { ...votes };
      if (next === undefined) delete copy[optionId];
      else copy[optionId] = next;
      return copy;
    });
  }

  async function save() {
    if (!editing) return;
    const name = nickname.trim();
    if (!name) {
      setError('Please enter a nickname.');
      return;
    }
    if (editing.kind === 'new' && !turnstileToken) {
      setError('Please complete the verification first.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (editing.kind === 'new') {
        const res = await api.addParticipant(event.id, {
          nickname: name,
          votes: draftVotes,
          turnstileToken: turnstileToken!,
        });
        const identity = { id: res.id, token: res.editToken };
        storage.setParticipant(event.id, identity);
        onIdentityChange(identity);
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
      await onChanged();
    } catch (err) {
      setError(describeError(err));
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
        storage.setParticipant(event.id, null);
        onIdentityChange(null);
      }
      setEditing(null);
      await onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeOption(optionId: string) {
    if (!adminToken) return;
    if (!window.confirm('Remove this date and every answer for it?')) return;

    setBusy(true);
    setError(null);
    try {
      await api.deleteOption(event.id, optionId, adminToken);
      await onChanged();
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
              onClick={() => toggle(o.id)}
              aria-label={`${formatDate(o.date)}: ${LABEL[cell]}`}
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

  const editingParticipant =
    editing?.kind === 'existing' ? event.participants.find((p) => p.id === editing.participantId) : undefined;

  return (
    <section className="card stack vote-section">
      <div className="table-scroll">
        <table className="vote-table">
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
                      onClick={() => removeOption(o.id)}
                      disabled={busy}
                      aria-label={`Remove ${formatDate(o.date)}`}
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
                      <input
                        className="input input-sm"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        maxLength={LIMITS.nicknameMax}
                        aria-label="Nickname"
                      />
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
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(p)} disabled={busy}>
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
                  <input
                    className="input input-sm"
                    autoFocus
                    placeholder="Your nickname"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    maxLength={LIMITS.nicknameMax}
                    aria-label="Nickname"
                  />
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

      {editing === null && !hasAnswered && (
        isFull ? (
          <p className="hint">This poll is full.</p>
        ) : (
          <div>
            <button type="button" className="btn btn-primary" onClick={startNew} disabled={busy}>
              Add your availability
            </button>
          </div>
        )
      )}

      {editing !== null && (
        <div className="edit-panel stack">
          <p className="hint">Tap a cell to cycle through ✓ yes, ~ if need be, ✕ no, and · no answer.</p>
          {editing.kind === 'new' && <TurnstileField ref={turnstileRef} onToken={setTurnstileToken} />}
          {error && (
            <p className="form-error" role="alert">
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
