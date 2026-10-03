import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { LIMITS } from '@shared/limits';
import { nameSchema } from '@shared/schemas';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { api } from '../lib/api';
import { usePoll, usePollActions } from '../state/AppStateProvider';
import { FormError } from './FormError';
import { StatusAnnouncer } from './StatusAnnouncer';
import { StorageNotice } from './StorageNotice';
import { TextField } from './TextField';
import { TurnstileField } from './TurnstileField';

/**
 * The first tile. Before joining it is the whole page below the title: a name, the Turnstile check and
 * Join, which creates the participant row that answers and comments are posted under. Once joined it
 * shows the name and lets the viewer change it; the organiser renames other people from their rows.
 * The organiser sees the whole poll without joining, so for them the form waits behind a button
 * rather than loading the Turnstile widget on every visit.
 */
export function NameCard() {
  const { event, me, adminToken, isAdmin } = usePoll();
  const id = useId();
  const mine = me ? event.participants.find((p) => p.id === me.id) : undefined;
  const [joining, setJoining] = useState(false);
  const joinButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <section className="card stack name-card" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Name</h2>
      {me === null ? (
        isAdmin && !joining ? (
          <div className="section-head">
            <p>You have not joined this poll yourself.</p>
            <button ref={joinButtonRef} type="button" className="btn btn-secondary" onClick={() => setJoining(true)}>
              Join this poll
            </button>
          </div>
        ) : (
          <JoinForm id={id} onCancel={isAdmin ? () => setJoining(false) : undefined} />
        )
      ) : (
        <RenameForm
          id={id}
          participantId={me.id}
          name={mine?.name ?? null}
          votes={mine?.votes ?? {}}
          auth={{ adminToken, participant: me }}
        />
      )}
    </section>
  );
}

interface JoinFormProps {
  id: string;
  /** Present when the form was opened on demand (the organiser), so it can be put away again. */
  onCancel?: () => void;
}

function JoinForm({ id, onCancel }: JoinFormProps) {
  const { event, adminToken } = usePoll();
  const { refresh, setIdentity } = usePollActions();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [token, setToken] = useState<string | null>(null);
  const { busy, error, run } = useAsyncAction();
  const turnstileRef = useRef<TurnstileInstance>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Opened on demand: typing is the next step, so focus starts in the field.
  useEffect(() => {
    if (onCancel) inputRef.current?.focus();
  }, [onCancel]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !token) return;
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) {
      setNameError(parsed.error.issues[0].message);
      inputRef.current?.focus();
      return;
    }
    setNameError(undefined);
    const joined = await run(async () => {
      // The admin token, when this browser has one, marks the row as the organiser's.
      const res = await api.addParticipant(
        event.id,
        { name: parsed.data, votes: {}, turnstileToken: token },
        adminToken,
      );
      // Fetch first, so the moment the identity lands the row is on screen with it; the identity is
      // stored either way, since the row exists.
      await refresh(event.id);
      setIdentity(event.id, { id: res.id, token: res.editToken });
    });
    if (!joined) {
      // A Turnstile token is single-use, so get a fresh one for the next attempt.
      turnstileRef.current?.reset();
      setToken(null);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate aria-label="Join the poll">
      <TextField
        id={`${id}-name`}
        ref={inputRef}
        label="Your name"
        value={name}
        onChange={(value) => {
          setName(value);
          setNameError(undefined);
        }}
        error={nameError}
        hint="Shown with your answers and comments."
        maxLength={LIMITS.nameMax}
        required
      />
      <StorageNotice consequence="you will not be able to change your answers or comment under this name later from this browser." />
      <TurnstileField action="answer" ref={turnstileRef} onToken={setToken} />
      <FormError message={error} />
      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={busy || !token}>
          {busy ? 'Joining' : 'Join'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

interface RenameProps {
  id: string;
  participantId: string;
  /** Null while the row has not arrived yet, right after joining or after a failed refresh. */
  name: string | null;
  votes: Record<string, 'yes' | 'no' | 'maybe'>;
  auth: { adminToken: string | null; participant: { id: string; token: string } };
}

function RenameForm({ id, participantId, name, votes, auth }: RenameProps) {
  const { event } = usePoll();
  const { refresh } = usePollActions();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | undefined>();
  const [status, setStatus] = useState('');
  const { busy, error, setError, run } = useAsyncAction();
  const changeButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef(false);

  // The form unmounts when it closes; focus goes back to the button that opened it once the request is done.
  useEffect(() => {
    if (open || busy || !returnFocus.current) return;
    returnFocus.current = false;
    changeButtonRef.current?.focus();
  }, [open, busy]);

  function start() {
    setDraft(name ?? '');
    setDraftError(undefined);
    setError(null);
    setOpen(true);
  }

  function close() {
    returnFocus.current = true;
    setOpen(false);
    setError(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const parsed = nameSchema.safeParse(draft);
    if (!parsed.success) {
      setDraftError(parsed.error.issues[0].message);
      inputRef.current?.focus();
      return;
    }
    setDraftError(undefined);
    if (parsed.data === name) {
      close();
      return;
    }
    // The save replaces the whole row, so the current answers travel along unchanged.
    const saved = await run(async () => {
      await api.updateParticipant(event.id, participantId, { name: parsed.data, votes }, auth);
      returnFocus.current = true;
      setOpen(false);
      await refresh(event.id);
    });
    if (saved) setStatus(`Your name is now ${parsed.data}.`);
  }

  return (
    <div className="stack">
      <StatusAnnouncer message={status} />
      {open ? (
        <form className="stack" onSubmit={save} noValidate aria-label="Change your name">
          <TextField
            id={`${id}-rename`}
            ref={inputRef}
            label="New name"
            value={draft}
            onChange={(value) => {
              setDraft(value);
              setDraftError(undefined);
            }}
            error={draftError}
            maxLength={LIMITS.nameMax}
            required
          />
          <FormError message={error} />
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving' : 'Save'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="section-head">
          <p>
            {name === null ? (
              'You are in this poll.'
            ) : (
              <>
                You are in this poll as <strong className="participant-name">{name}</strong>.
              </>
            )}
          </p>
          <button
            ref={changeButtonRef}
            type="button"
            className="btn btn-ghost"
            onClick={start}
            disabled={name === null}
          >
            Change name
          </button>
        </div>
      )}
      {!open && <FormError message={error} />}
    </div>
  );
}
