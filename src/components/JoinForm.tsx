import { useId, useRef, useState, type FormEvent } from 'react';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { LIMITS } from '@shared/limits';
import { nicknameSchema } from '@shared/schemas';
import { FormError } from './FormError';
import { StorageNotice } from './StorageNotice';
import { TextField } from './TextField';
import { TurnstileField } from './TurnstileField';

interface Props {
  busy: boolean;
  /** The last failure of the join request, shown under the form. */
  error: string | null;
  /** Resolves to whether joining succeeded. On failure the draft stays and Turnstile is asked for a fresh token. */
  onJoin: (nickname: string, turnstileToken: string) => Promise<boolean>;
}

/**
 * The first step of taking part: pick a nickname, once. It creates the participant row that both the
 * availability answers and the comments are posted under. Shown above the table until this browser
 * holds an identity for the poll; VoteGrid runs the request and opens the new row for editing.
 */
export function JoinForm({ busy, error, onJoin }: Props) {
  const id = useId();
  const [nickname, setNickname] = useState('');
  const [nicknameError, setNicknameError] = useState<string | undefined>();
  const [token, setToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !token) return;
    const parsed = nicknameSchema.safeParse(nickname);
    if (!parsed.success) {
      setNicknameError(parsed.error.issues[0].message);
      inputRef.current?.focus();
      return;
    }
    setNicknameError(undefined);
    if (!(await onJoin(parsed.data, token))) {
      // A Turnstile token is single-use, so get a fresh one for the next attempt.
      turnstileRef.current?.reset();
      setToken(null);
    }
  }

  return (
    <form className="join-form stack" onSubmit={submit} noValidate aria-label="Join the poll">
      <TextField
        id={`${id}-nickname`}
        ref={inputRef}
        label="Your nickname"
        value={nickname}
        onChange={(value) => {
          setNickname(value);
          setNicknameError(undefined);
        }}
        error={nicknameError}
        hint="Your answers and comments appear under it."
        maxLength={LIMITS.nicknameMax}
        required
      />
      <StorageNotice consequence="you will not be able to change your answers or comment under this nickname later from this browser." />
      <TurnstileField action="answer" ref={turnstileRef} onToken={setToken} />
      <FormError message={error} />
      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={busy || !token}>
          {busy ? 'Joining' : 'Join'}
        </button>
      </div>
    </form>
  );
}
