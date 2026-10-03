import { useEffect, useId, useMemo, useReducer, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { LIMITS } from '@shared/limits';
import { eventDraftSchema } from '@shared/schemas';
import { Calendar } from '../components/Calendar';
import { FormError } from '../components/FormError';
import { ProgressSteps } from '../components/ProgressSteps';
import { TextField } from '../components/TextField';
import { TurnstileField } from '../components/TurnstileField';
import { api } from '../lib/api';
import { formatDate, todayIso } from '../lib/dates';
import { describeError } from '../lib/errors';
import { storage } from '../lib/storage';
import { sleep, waitUntil } from '../lib/timing';
import { createFormReducer, firstInvalidField, initialCreateForm, type FieldKey } from '../state/createForm';

const STEPS = ['Validating', 'Setting up', 'Creating links', 'Done'] as const;

/**
 * The progress steps pace themselves on the wait the ticket response asks for:
 * steps 1 and 2 begin at these shares of the total, and the create request goes
 * out once the ticket is old enough plus a little headroom for clock drift.
 */
const STEP_STARTS = [0.28, 0.62] as const;
const TICKET_HEADROOM_MS = 800;

export function CreatePage() {
  const navigate = useNavigate();
  const id = useId();
  const [form, dispatch] = useReducer(createFormReducer, initialCreateForm);
  const { title, description, allowSuggestions, turnstileToken, fieldErrors, progress } = form;
  const turnstileRef = useRef<TurnstileInstance>(null);

  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const datesRef = useRef<HTMLDivElement>(null);
  const focusAfterErrors = useRef<FieldKey | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const dates = useMemo(() => [...form.dates].sort(), [form.dates]);

  // Focus the first invalid field once its error is in the DOM, so it is read together with the field.
  useEffect(() => {
    const key = focusAfterErrors.current;
    if (!key) return;
    focusAfterErrors.current = null;
    (key === 'title' ? titleRef : key === 'description' ? descriptionRef : datesRef).current?.focus();
  }, [fieldErrors]);

  // A native <dialog> opened with showModal() moves and traps focus and makes the form behind inert.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (progress && !dialog.open) dialog.showModal();
    else if (!progress && dialog.open) dialog.close();
  }, [progress]);

  const toggleDate = (iso: string) => dispatch({ type: 'toggleDate', iso });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const parsed = eventDraftSchema.safeParse({ title, description, dates, allowSuggestions });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        errors[key] ??= issue.message;
      }
      focusAfterErrors.current = firstInvalidField(errors);
      dispatch({ type: 'errors', errors });
      return;
    }
    if (!turnstileToken) {
      dispatch({ type: 'errors', errors: { form: 'Please complete the verification first.' } });
      return;
    }
    dispatch({ type: 'errors', errors: {} });

    const startedAt = Date.now();
    dispatch({ type: 'progress', step: 0 });
    try {
      const { ticket, minAgeMs } = await api.createTicket();
      // Counted from when the response arrived, so the Worker sees the ticket as old enough
      // whatever the two clocks say.
      const sendAt = Date.now() + minAgeMs + TICKET_HEADROOM_MS;
      const total = sendAt - startedAt;
      await waitUntil(startedAt + total * STEP_STARTS[0]);
      dispatch({ type: 'progress', step: 1 });
      await waitUntil(startedAt + total * STEP_STARTS[1]);
      dispatch({ type: 'progress', step: 2 });
      await waitUntil(sendAt);

      const created = await api.createEvent({ ...parsed.data, ticket, turnstileToken });
      storage.setAdminToken(created.id, created.adminToken);
      dispatch({ type: 'progress', step: 3 });
      await sleep(700);
      navigate(`/e/${created.id}`);
    } catch (err) {
      dispatch({ type: 'progressFailed', message: describeError(err) });
      turnstileRef.current?.reset();
      dispatch({ type: 'turnstile', token: null });
    }
  }

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
        <TextField
          id={`${id}-title`}
          ref={titleRef}
          label="What are you planning?"
          value={title}
          onChange={(value) => dispatch({ type: 'field', key: 'title', value })}
          error={fieldErrors.title}
          maxLength={LIMITS.titleMax}
          placeholder="Team dinner, board game night, …"
        />

        <TextField
          id={`${id}-description`}
          ref={descriptionRef}
          label={
            <>
              Details <em className="muted">optional</em>
            </>
          }
          value={description}
          onChange={(value) => dispatch({ type: 'field', key: 'description', value })}
          error={fieldErrors.description}
          multiline
          maxLength={LIMITS.descriptionMax}
          placeholder="Where, what time, what to bring…"
        />

        <div
          ref={datesRef}
          className="field"
          role="group"
          tabIndex={-1}
          aria-labelledby={`${id}-dates-label`}
          aria-describedby={fieldErrors.dates ? `${id}-dates-error` : undefined}
        >
          <span id={`${id}-dates-label`} className="field-label">
            Which dates could work?
          </span>
          <Calendar selected={form.dates} onToggle={toggleDate} minDate={todayIso()} />
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
          <input
            type="checkbox"
            checked={allowSuggestions}
            onChange={(e) => dispatch({ type: 'allowSuggestions', value: e.target.checked })}
          />
          <span>Let participants suggest other dates</span>
        </label>

        <TurnstileField
          action="create"
          ref={turnstileRef}
          onToken={(token) => dispatch({ type: 'turnstile', token })}
        />

        <FormError message={fieldErrors.form} />

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
        onClose={() => dispatch({ type: 'progressCleared' })}
      >
        {progress && (
          <div className="card progress-card stack">
            <h2 id={`${id}-progress-title`}>{progress.failed ? 'Could not create the poll' : 'Creating your poll'}</h2>
            <ProgressSteps steps={STEPS} current={progress.step} failed={progress.failed} />
            {progress.failed && (
              <>
                <FormError message={progress.message} />
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    // Deliberate (review finding A4): the only control in the dialog once creation has failed.
                    // eslint-disable-next-line jsx-a11y/no-autofocus
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
