import { useId, useRef, useState } from 'react';
import { LIMITS } from '@shared/limits';
import { useJoinForm, useRenameForm } from '../hooks/useNameForms';
import { participantLink } from '../lib/participantLink';
import { usePoll } from '../state/AppStateProvider';
import { FormError } from './FormError';
import { CopyField } from './CopyField';
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
  const { event, me, adminToken, isAdmin, identityError } = usePoll();
  const id = useId();
  const mine = me ? event.participants.find((p) => p.id === me.id) : undefined;
  // Opening a guest's private link in an organiser's browser must never give that guest admin access.
  const privateAdminToken = mine?.isOrganiser ? adminToken : null;
  const [joining, setJoining] = useState(false);
  const joinButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <section className="card stack name-card" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Name</h2>
      {identityError ? (
        <p>Your name could not be confirmed. Try again above to edit answers or comment.</p>
      ) : me === null ? (
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
      ) : mine?.isDisabled ? (
        <p>
          You are in this poll as <strong className="participant-name">{mine.name}</strong>, but the organiser has
          disabled you. Your answers no longer count and only the organiser sees them. You can still follow the poll.
        </p>
      ) : (
        <RenameForm id={id} participantId={me.id} name={mine?.name ?? null} auth={{ adminToken, participant: me }} />
      )}
      {me && (
        <CopyField
          label="Your private link"
          value={participantLink(window.location.origin, event.id, me, privateAdminToken)}
          hint={
            privateAdminToken
              ? 'Save this link to return on any device with your organiser access. Keep it private: anyone with it can edit or delete the poll and comment as you.'
              : 'Save this link to return on any device, even after clearing browser data. Keep it private: anyone with it can change your answers and comment as you.'
          }
        />
      )}
      {me && (
        <StorageNotice consequence="save your private link and reopen it after a reload or when this tab closes." />
      )}
    </section>
  );
}

interface JoinFormProps {
  id: string;
  /** Present when the form was opened on demand (the organiser), so it can be put away again. */
  onCancel?: () => void;
}

const JoinForm = ({ id, onCancel }: JoinFormProps) => {
  const { name, onNameChange, nameError, token, setToken, busy, error, turnstileRef, inputRef, submit } = useJoinForm(
    onCancel !== undefined,
  );
  return (
    <form className="stack" onSubmit={submit} noValidate aria-label="Join the poll">
      <TextField
        id={`${id}-name`}
        ref={inputRef}
        label="Your name"
        value={name}
        onChange={onNameChange}
        error={nameError}
        hint="Shown with your answers and comments. After joining, save your private link to return on another device."
        maxLength={LIMITS.nameMax}
        required
      />
      <StorageNotice consequence="save your private link after joining to change your answers or comment under this name later." />
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
};

interface RenameProps {
  id: string;
  participantId: string;
  /** Null while the row has not arrived yet, right after joining or after a failed refresh. */
  name: string | null;
  auth: { adminToken: string | null; participant: { id: string; token: string } };
}

const RenameForm = ({ id, participantId, name, auth }: RenameProps) => {
  const { open, draft, onDraftChange, draftError, status, busy, error, changeButtonRef, inputRef, start, close, save } =
    useRenameForm({ participantId, name, auth });
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
            onChange={onDraftChange}
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
};
