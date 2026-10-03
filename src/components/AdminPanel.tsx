import { useEffect, useId, useReducer, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { LIMITS } from '@shared/limits';
import { updateEventSchema } from '@shared/schemas';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { api } from '../lib/api';
import { useAdminToken, usePoll, usePollActions } from '../state/AppStateProvider';
import { adminFormFromEvent, adminFormReducer, type AdminFieldKey } from '../state/adminForm';
import { FormError } from './FormError';
import { ConfirmDialog } from './ConfirmDialog';
import { StatusAnnouncer } from './StatusAnnouncer';
import { TextField } from './TextField';

type FocusTarget = AdminFieldKey | 'opener';

export function AdminPanel() {
  const { event } = usePoll();
  const adminToken = useAdminToken();
  const { refresh, forgetPoll } = usePollActions();
  const navigate = useNavigate();
  const id = useId();
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

  function close() {
    pendingFocus.current = 'opener';
    dispatch({ type: 'close' });
    setError(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = updateEventSchema.safeParse({ title, description, allowSuggestions });
    if (!parsed.success) {
      const errors: Partial<Record<AdminFieldKey, string>> = {};
      let formError: string | null = null;
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'title' || key === 'description') errors[key] ??= issue.message;
        else formError ??= issue.message;
      }
      pendingFocus.current = errors.title ? 'title' : errors.description ? 'description' : null;
      dispatch({ type: 'errors', errors });
      setError(formError);
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
  }

  async function destroy() {
    if (busy) return;
    await run(async () => {
      await api.deleteEvent(event.id, adminToken);
      forgetPoll(event.id);
      navigate('/');
    });
  }

  return (
    <section className="card stack">
      <div className="section-head">
        <h2>Organiser</h2>
        <div className="btn-row">
          {!open && (
            <button
              ref={editButtonRef}
              type="button"
              className="btn btn-secondary"
              onClick={() => dispatch({ type: 'open' })}
              disabled={busy}
            >
              Edit details
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost danger"
            onClick={() => {
              setError(null);
              setConfirmDelete(true);
            }}
            disabled={busy}
          >
            Delete poll
          </button>
        </div>
      </div>
      <StatusAnnouncer message={status} />

      {open && (
        <form className="stack" onSubmit={save} noValidate>
          <TextField
            id={`${id}-title`}
            ref={titleRef}
            label="Title"
            value={title}
            onChange={(value) => dispatch({ type: 'field', key: 'title', value })}
            error={fieldErrors.title}
            maxLength={LIMITS.titleMax}
            required
          />
          <TextField
            id={`${id}-description`}
            ref={descriptionRef}
            label="Details"
            value={description}
            onChange={(value) => dispatch({ type: 'field', key: 'description', value })}
            error={fieldErrors.description}
            multiline
            maxLength={LIMITS.descriptionMax}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={allowSuggestions}
              onChange={(e) => dispatch({ type: 'allowSuggestions', value: e.target.checked })}
            />
            <span>Participants may suggest other dates</span>
          </label>
          <FormError message={confirmDelete ? null : error} />
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving' : 'Save'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {!open && !confirmDelete && <FormError message={error} />}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this poll?"
          description="The poll and every answer in it will be permanently deleted. This cannot be undone."
          confirmLabel="Delete poll"
          busyLabel="Deleting poll…"
          busy={busy}
          error={error}
          onConfirm={destroy}
          onCancel={() => {
            setConfirmDelete(false);
            setError(null);
          }}
        />
      )}
    </section>
  );
}
