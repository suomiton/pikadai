import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { nameSchema } from '@shared/schemas';
import { api } from '../lib/api';
import { usePoll, usePollActions } from '../state/AppStateProvider';
import { useAsyncAction } from './useAsyncAction';

export function useJoinForm(onCancel?: () => void) {
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

  const register = async (joinedName: string, turnstileToken: string) => {
    // The admin token, when this browser has one, marks the row as the organiser's.
    const res = await api.addParticipant(event.id, { name: joinedName, votes: {}, turnstileToken }, adminToken);
    // Fetch first, so the moment the identity lands the row is on screen with it; the identity is
    // stored either way, since the row exists.
    await refresh(event.id);
    setIdentity(event.id, { id: res.id, token: res.editToken });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !token) return;
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) {
      setNameError(parsed.error.issues[0].message);
      inputRef.current?.focus();
      return;
    }
    setNameError(undefined);
    const joined = await run(() => register(parsed.data, token));
    if (!joined) {
      // A Turnstile token is single-use, so get a fresh one for the next attempt.
      turnstileRef.current?.reset();
      setToken(null);
    }
  };

  return { name, setName, nameError, setNameError, token, setToken, busy, error, turnstileRef, inputRef, submit };
}

export interface RenameFormInput {
  participantId: string;
  /** Null while the row has not arrived yet, right after joining or after a failed refresh. */
  name: string | null;
  auth: { adminToken: string | null; participant: { id: string; token: string } };
}

export function useRenameForm({ participantId, name, auth }: RenameFormInput) {
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

  const start = () => {
    setDraft(name ?? '');
    setDraftError(undefined);
    setError(null);
    setOpen(true);
  };

  const close = () => {
    returnFocus.current = true;
    setOpen(false);
    setError(null);
  };

  const save = async (e: FormEvent) => {
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
    // Name only: an answer saved from the table at the same moment cannot be overwritten by this.
    const saved = await run(async () => {
      await api.updateParticipant(event.id, participantId, { name: parsed.data }, auth);
      returnFocus.current = true;
      setOpen(false);
      await refresh(event.id);
    });
    if (saved) setStatus(`Your name is now ${parsed.data}.`);
  };

  return {
    open,
    draft,
    setDraft,
    draftError,
    setDraftError,
    status,
    busy,
    error,
    changeButtonRef,
    inputRef,
    start,
    close,
    save,
  };
}
