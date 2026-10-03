import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { LIMITS } from '@shared/limits';
import { eventDraftSchema } from '@shared/schemas';
import { Calendar } from '../components/Calendar';
import { ProgressSteps } from '../components/ProgressSteps';
import { TurnstileField } from '../components/TurnstileField';
import { api } from '../lib/api';
import { formatDate, todayIso } from '../lib/dates';
import { describeError } from '../lib/errors';
import { storage } from '../lib/storage';
import { sleep, waitUntil } from '../lib/timing';

const STEPS = ['Validating', 'Setting up', 'Creating links', 'Done'] as const;

/**
 * The progress steps pace themselves on the wait the ticket response asks for:
 * steps 1 and 2 begin at these shares of the total, and the create request goes
 * out once the ticket is old enough plus a little headroom for clock drift.
 */
const STEP_STARTS = [0.28, 0.62] as const;
const TICKET_HEADROOM_MS = 800;

/** Fields that can carry a validation error, in the order focus should visit them. */
type FieldKey = 'title' | 'description' | 'dates';
const FIELD_ORDER: readonly FieldKey[] = ['title', 'description', 'dates'];

interface Progress {
  step: number;
  failed: boolean;
  message: string | null;
}

export function CreatePage() {
  const navigate = useNavigate();
  const id = useId();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [allowSuggestions, setAllowSuggestions] = useState(true);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<Progress | null>(null);

  const fieldRefs = {
    title: useRef<HTMLInputElement>(null),
    description: useRef<HTMLTextAreaElement>(null),
    dates: useRef<HTMLDivElement>(null),
  };
  const focusAfterErrors = useRef<FieldKey | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const dates = useMemo(() => [...selected].sort(), [selected]);

  // Focus the first invalid field once its error is in the DOM, so it is read together with the field.
  useEffect(() => {
    const key = focusAfterErrors.current;
    if (!key) return;
    focusAfterErrors.current = null;
    fieldRefs[key].current?.focus();
  }, [fieldErrors]);

  // A native <dialog> opened with showModal() moves and traps focus and makes the form behind inert.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (progress && !dialog.open) dialog.showModal();
    else if (!progress && dialog.open) dialog.close();
  }, [progress]);

  function toggleDate(iso: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const parsed = eventDraftSchema.safeParse({ title, description, dates, allowSuggestions });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        errors[key] ??= issue.message;
      }
      focusAfterErrors.current = FIELD_ORDER.find((key) => key in errors) ?? null;
      setFieldErrors(errors);
      return;
    }
    if (!turnstileToken) {
      setFieldErrors({ form: 'Please complete the verification first.' });
      return;
    }
    setFieldErrors({});

    const startedAt = Date.now();
    setProgress({ step: 0, failed: false, message: null });
    try {
      const { ticket, minAgeMs } = await api.createTicket();
      // Counted from when the response arrived, so the Worker sees the ticket as old enough
      // whatever the two clocks say.
      const sendAt = Date.now() + minAgeMs + TICKET_HEADROOM_MS;
      const total = sendAt - startedAt;
      await waitUntil(startedAt + total * STEP_STARTS[0]);
      setProgress({ step: 1, failed: false, message: null });
      await waitUntil(startedAt + total * STEP_STARTS[1]);
      setProgress({ step: 2, failed: false, message: null });
      await waitUntil(sendAt);

      const created = await api.createEvent({ ...parsed.data, ticket, turnstileToken });
      storage.setAdminToken(created.id, created.adminToken);
      setProgress({ step: 3, failed: false, message: null });
      await sleep(700);
      navigate(`/e/${created.id}`);
    } catch (err) {
      setProgress((p) => ({ step: p?.step ?? 0, failed: true, message: describeError(err) }));
      turnstileRef.current?.reset();
      setTurnstileToken(null);
    }
  }

  const describedBy = (key: FieldKey) => (fieldErrors[key] ? `${id}-${key}-error` : undefined);
  const invalid = (key: FieldKey) => (fieldErrors[key] ? true : undefined);

  return (
    <>
      <section className="hero">
        <h1>Find a date that works for everyone.</h1>
        <p>
          Pick some dates, share one link, and let people answer with just a nickname. No login, no email, no tracking.
          The poll deletes itself after it expires.
        </p>
      </section>

      <form className="card stack create-form" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-title`}>
            What are you planning?
          </label>
          <input
            id={`${id}-title`}
            ref={fieldRefs.title}
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={LIMITS.titleMax}
            placeholder="Team dinner, board game night, …"
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
            Details <em className="muted">optional</em>
          </label>
          <textarea
            id={`${id}-description`}
            ref={fieldRefs.description}
            className="input"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={LIMITS.descriptionMax}
            placeholder="Where, what time, what to bring…"
            aria-invalid={invalid('description')}
            aria-describedby={describedBy('description')}
          />
          {fieldErrors.description && (
            <span id={`${id}-description-error`} className="field-error">
              {fieldErrors.description}
            </span>
          )}
        </div>

        <div
          ref={fieldRefs.dates}
          className="field"
          role="group"
          tabIndex={-1}
          aria-labelledby={`${id}-dates-label`}
          aria-invalid={invalid('dates')}
          aria-describedby={describedBy('dates')}
        >
          <span id={`${id}-dates-label`} className="field-label">
            Which dates could work?
          </span>
          <Calendar selected={selected} onToggle={toggleDate} minDate={todayIso()} />
          {dates.length > 0 && (
            <ul className="chips" aria-label="Selected dates">
              {dates.map((d) => (
                <li key={d} className="chip">
                  {formatDate(d)}
                  <button type="button" onClick={() => toggleDate(d)} aria-label={`Remove ${formatDate(d)}`}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {fieldErrors.dates && (
            <span id={`${id}-dates-error`} className="field-error">
              {fieldErrors.dates}
            </span>
          )}
        </div>

        <label className="check">
          <input type="checkbox" checked={allowSuggestions} onChange={(e) => setAllowSuggestions(e.target.checked)} />
          <span>Let participants suggest other dates</span>
        </label>

        <TurnstileField action="create" ref={turnstileRef} onToken={setTurnstileToken} />

        {fieldErrors.form && (
          <p className="form-error" role="alert">
            {fieldErrors.form}
          </p>
        )}

        <div className="btn-row">
          <button type="submit" className="btn btn-primary btn-lg" disabled={!turnstileToken}>
            Create poll
          </button>
        </div>
      </form>

      <dialog
        ref={dialogRef}
        className="progress-dialog"
        aria-labelledby={`${id}-progress-title`}
        onCancel={(e) => {
          // Escape must not dismiss a creation that is still running.
          if (!progress?.failed) e.preventDefault();
        }}
        onClose={() => setProgress(null)}
      >
        {progress && (
          <div className="card progress-card stack">
            <h2 id={`${id}-progress-title`}>{progress.failed ? 'Could not create the poll' : 'Creating your poll'}</h2>
            <ProgressSteps steps={STEPS} current={progress.step} failed={progress.failed} />
            {progress.failed && (
              <>
                <p className="form-error" role="alert">
                  {progress.message}
                </p>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    autoFocus
                    onClick={() => dialogRef.current?.close()}
                  >
                    Back to the form
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
