import { useMemo, useRef, useState, type FormEvent } from 'react';
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
 * Wall-clock offsets (ms after submit) at which each step hands over to the next.
 * The last offset is when the create request is actually sent; it must exceed the
 * Worker's MIN_CREATE_DELAY_MS or the creation ticket is rejected as too early.
 */
const STEP_ENDS = [1600, 3600, LIMITS.minCreateDelayMs + 800] as const;

interface Progress {
  step: number;
  failed: boolean;
  message: string | null;
}

export function CreatePage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [allowSuggestions, setAllowSuggestions] = useState(true);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<Progress | null>(null);

  const dates = useMemo(() => [...selected].sort(), [selected]);

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
      const { ticket } = await api.createTicket();
      await waitUntil(startedAt + STEP_ENDS[0]);
      setProgress({ step: 1, failed: false, message: null });
      await waitUntil(startedAt + STEP_ENDS[1]);
      setProgress({ step: 2, failed: false, message: null });
      await waitUntil(startedAt + STEP_ENDS[2]);

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

  return (
    <>
      <section className="hero">
        <h1>Find a date that works for everyone.</h1>
        <p>
          Pick some dates, share one link, and let people answer with just a nickname. No login, no email,
          no tracking. The poll deletes itself after it expires.
        </p>
      </section>

      <form className="card stack create-form" onSubmit={handleSubmit} noValidate>
        <label className="field">
          <span className="field-label">What are you planning?</span>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={LIMITS.titleMax}
            placeholder="Team dinner, board game night, …"
            autoFocus
          />
          {fieldErrors.title && <span className="field-error">{fieldErrors.title}</span>}
        </label>

        <label className="field">
          <span className="field-label">
            Details <em className="muted">optional</em>
          </span>
          <textarea
            className="input"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={LIMITS.descriptionMax}
            placeholder="Where, what time, what to bring…"
          />
          {fieldErrors.description && <span className="field-error">{fieldErrors.description}</span>}
        </label>

        <div className="field">
          <span className="field-label">Which dates could work?</span>
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
          {fieldErrors.dates && <span className="field-error">{fieldErrors.dates}</span>}
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={allowSuggestions}
            onChange={(e) => setAllowSuggestions(e.target.checked)}
          />
          <span>Let participants suggest other dates</span>
        </label>

        <TurnstileField ref={turnstileRef} onToken={setTurnstileToken} />

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

      {progress && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Creating your poll">
          <div className="card progress-card stack">
            <h2>{progress.failed ? 'Could not create the poll' : 'Creating your poll'}</h2>
            <ProgressSteps steps={STEPS} current={progress.step} failed={progress.failed} />
            {progress.failed && (
              <>
                <p className="form-error" role="alert">
                  {progress.message}
                </p>
                <div className="btn-row">
                  <button type="button" className="btn btn-secondary" onClick={() => setProgress(null)}>
                    Back to the form
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
