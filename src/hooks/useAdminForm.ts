import { useEffect, useReducer, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { updateEventSchema } from '@shared/schemas';
import { api } from '../lib/api';
import { fieldErrorsFromIssues } from '../lib/validation';
import { useAdminToken, usePoll, usePollActions } from '../state/AppStateProvider';
import { adminFormFromEvent, adminFormReducer, type AdminFieldKey } from '../state/adminForm';
import { useAsyncAction } from './useAsyncAction';

type FocusTarget = AdminFieldKey | 'opener';

/** Keeps the organiser's draft, requests and focus together while the view renders the controls. */
export function useAdminForm() {
  const { event } = usePoll();
  const adminToken = useAdminToken();
  const { refresh, forgetPoll } = usePollActions();
  const navigate = useNavigate();
  const [form, dispatch] = useReducer(adminFormReducer, event, adminFormFromEvent);
  const { open, title, description, allowSuggestions, fieldErrors } = form;
  const { busy, error, setError, run } = useAsyncAction();
  const [status, setStatus] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const editButtonRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  // While the form is closed it mirrors the saved values, so reopening never shows an old draft.
  useEffect(() => {
    dispatch({ type: 'sync', event });
  }, [event, open]);

  // The form unmounts when it closes, so focus goes back to the button that opened it; on a
  // validation error, focus lands on the first invalid field once its message is in the DOM.
  // While a request is in flight the buttons are disabled and cannot take focus, so wait for it.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || busy) return;
    pendingFocus.current = null;
    if (target === 'opener') editButtonRef.current?.focus();
    else (target === 'title' ? titleRef : descriptionRef).current?.focus();
  }, [open, fieldErrors, busy]);

  const close = () => {
    pendingFocus.current = 'opener';
    dispatch({ type: 'close' });
    setError(null);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = updateEventSchema.safeParse({ title, description, allowSuggestions });
    if (!parsed.success) {
      const { form: formError, ...errors } = fieldErrorsFromIssues(parsed.error.issues, ['title', 'description']);
      pendingFocus.current = errors.title ? 'title' : errors.description ? 'description' : null;
      dispatch({ type: 'errors', errors });
      setError(formError ?? null);
      return;
    }
    dispatch({ type: 'errors', errors: {} });
    const saved = await run(async () => {
      await api.updateEvent(event.id, parsed.data, adminToken);
      pendingFocus.current = 'opener';
      dispatch({ type: 'close' });
      await refresh(event.id);
    });
    if (saved) setStatus('Details saved.');
  };

  const destroy = async () => {
    if (busy) return;
    await run(async () => {
      await api.deleteEvent(event.id, adminToken);
      forgetPoll(event.id);
      navigate('/');
    });
  };

  return {
    form,
    dispatch,
    busy,
    error,
    status,
    confirmDelete,
    setConfirmDelete,
    setError,
    close,
    save,
    destroy,
    refs: { editButtonRef, titleRef, descriptionRef },
  };
}

export type AdminFormController = ReturnType<typeof useAdminForm>;
