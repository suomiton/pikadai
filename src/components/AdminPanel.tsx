import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { LIMITS } from '@shared/limits';
import { updateEventSchema } from '@shared/schemas';
import type { EventView } from '@shared/types';
import { api } from '../lib/api';
import { describeError } from '../lib/errors';
import { storage } from '../lib/storage';

interface Props {
  event: EventView;
  adminToken: string;
  onChanged: () => Promise<void>;
}

type FieldKey = 'title' | 'description';
type FocusTarget = FieldKey | 'opener';

export function AdminPanel({ event, adminToken, onChanged }: Props) {
  const navigate = useNavigate();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description);
  const [allowSuggestions, setAllowSuggestions] = useState(event.allowSuggestions);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const editButtonRef = useRef<HTMLButtonElement>(null);
  const fieldRefs = {
    title: useRef<HTMLInputElement>(null),
    description: useRef<HTMLTextAreaElement>(null),
  };
  const pendingFocus = useRef<FocusTarget | null>(null);

  useEffect(() => {
    if (open) return;
    setTitle(event.title);
    setDescription(event.description);
    setAllowSuggestions(event.allowSuggestions);
  }, [event, open]);

  // The form unmounts when it closes, so focus goes back to the button that opened it; on a
  // validation error, focus lands on the first invalid field once its message is in the DOM.
  // While a request is in flight the buttons are disabled and cannot take focus, so wait for it.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || busy) return;
    pendingFocus.current = null;
    if (target === 'opener') editButtonRef.current?.focus();
    else fieldRefs[target].current?.focus();
  }, [open, fieldErrors, busy]);

  function close() {
    pendingFocus.current = 'opener';
    setOpen(false);
    setFieldErrors({});
    setError(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = updateEventSchema.safeParse({ title, description, allowSuggestions });
    if (!parsed.success) {
      const errors: Partial<Record<FieldKey, string>> = {};
      let formError: string | null = null;
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'title' || key === 'description') errors[key] ??= issue.message;
        else formError ??= issue.message;
      }
      pendingFocus.current = errors.title ? 'title' : errors.description ? 'description' : null;
      setFieldErrors(errors);
      setError(formError);
      return;
    }
    setBusy(true);
    setFieldErrors({});
    setError(null);
    try {
      await api.updateEvent(event.id, parsed.data, adminToken);
      pendingFocus.current = 'opener';
      setOpen(false);
      await onChanged();
      setStatus('Details saved.');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    if (!window.confirm('Delete this poll and every answer in it? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteEvent(event.id, adminToken);
      storage.setAdminToken(event.id, null);
      storage.setParticipant(event.id, null);
      navigate('/');
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  const describedBy = (key: FieldKey) => (fieldErrors[key] ? `${id}-${key}-error` : undefined);
  const invalid = (key: FieldKey) => (fieldErrors[key] ? true : undefined);

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
              onClick={() => setOpen(true)}
              disabled={busy}
            >
              Edit details
            </button>
          )}
          <button type="button" className="btn btn-ghost danger" onClick={destroy} disabled={busy}>
            Delete poll
          </button>
        </div>
      </div>
      <p className="visually-hidden" role="status">
        {status}
      </p>

      {open && (
        <form className="stack" onSubmit={save} noValidate>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-title`}>
              Title
            </label>
            <input
              id={`${id}-title`}
              ref={fieldRefs.title}
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={LIMITS.titleMax}
              required
              aria-invalid={invalid('title')}
              aria-describedby={describedBy('title')}
            />
            {fieldErrors.title && (
              <span id={`${id}-title-error`} className="field-error">
                {fieldErrors.title}
              </span>
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-description`}>
              Details
            </label>
            <textarea
              id={`${id}-description`}
              ref={fieldRefs.description}
              className="input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={LIMITS.descriptionMax}
              aria-invalid={invalid('description')}
              aria-describedby={describedBy('description')}
            />
            {fieldErrors.description && (
              <span id={`${id}-description-error`} className="field-error">
                {fieldErrors.description}
              </span>
            )}
          </div>
          <label className="check">
            <input type="checkbox" checked={allowSuggestions} onChange={(e) => setAllowSuggestions(e.target.checked)} />
            <span>Participants may suggest other dates</span>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
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
      {!open && error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
