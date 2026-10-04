import { useId, type Ref } from 'react';
import { LIMITS } from '@shared/limits';
import { Calendar } from '../components/Calendar';
import { FormError } from '../components/FormError';
import { Modal } from '../components/Modal';
import { ProgressSteps } from '../components/ProgressSteps';
import { TextField } from '../components/TextField';
import { TurnstileField } from '../components/TurnstileField';
import { useCreateForm, type CreateFormController } from '../hooks/useCreateForm';
import { formatDate, todayIso } from '../lib/dates';
import type { Progress } from '../state/createForm';

const STEPS = ['Validating', 'Setting up', 'Creating links', 'Done'] as const;

interface DateFieldProps {
  id: string;
  selected: ReadonlySet<string>;
  dates: readonly string[];
  error?: string;
  onToggle: (iso: string) => void;
  ref: Ref<HTMLDivElement>;
}

const CreateDateField = ({ id, selected, dates, error, onToggle, ref }: DateFieldProps) => (
  <div
    ref={ref}
    className="field"
    role="group"
    tabIndex={-1}
    aria-labelledby={`${id}-dates-label`}
    aria-describedby={error ? `${id}-dates-error` : undefined}
  >
    <span id={`${id}-dates-label`} className="field-label">
      Which dates could work?
    </span>
    <Calendar selected={selected} onToggle={onToggle} minDate={todayIso()} />
    {dates.length > 0 && (
      <ul className="chips" aria-label="Selected dates">
        {dates.map((d) => (
          <li key={d} className="chip">
            {formatDate(d)}
            <button type="button" onClick={() => onToggle(d)} aria-label={`Remove ${formatDate(d)}`}>
              ×
            </button>
          </li>
        ))}
      </ul>
    )}
    {error && (
      <span id={`${id}-dates-error`} className="field-error">
        {error}
      </span>
    )}
  </div>
);

const CreatePollForm = ({ controller }: { controller: CreateFormController }) => {
  const id = useId();
  const { form, dates, dispatch, handleSubmit, toggleDate, refs } = controller;
  const { title, description, allowSuggestions, turnstileToken, fieldErrors } = form;
  const { titleRef, descriptionRef, datesRef, turnstileRef } = refs;
  return (
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

      <CreateDateField
        id={id}
        ref={datesRef}
        selected={form.dates}
        dates={dates}
        error={fieldErrors.dates}
        onToggle={toggleDate}
      />

      <label className="check">
        <input
          type="checkbox"
          checked={allowSuggestions}
          onChange={(e) => dispatch({ type: 'allowSuggestions', value: e.target.checked })}
        />
        <span>Let participants suggest other dates</span>
      </label>

      <TurnstileField action="create" ref={turnstileRef} onToken={(token) => dispatch({ type: 'turnstile', token })} />

      <FormError message={fieldErrors.form} />

      <div className="btn-row">
        <button type="submit" className="btn btn-primary btn-lg" disabled={!turnstileToken}>
          Create poll
        </button>
      </div>
    </form>
  );
};

interface ProgressDialogProps {
  progress: Progress;
  onDismiss: () => void;
  returnFocusRef: CreateFormController['refs']['titleRef'];
}

const CreateProgressDialog = ({ progress, onDismiss, returnFocusRef }: ProgressDialogProps) => (
  <Modal
    title={progress.failed ? 'Could not create the poll' : 'Creating your poll'}
    dismissible={progress.failed}
    onDismiss={onDismiss}
    returnFocusRef={returnFocusRef}
  >
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
            onClick={onDismiss}
          >
            Back to the form
          </button>
        </div>
      </>
    )}
  </Modal>
);

export function CreatePage() {
  const controller = useCreateForm();
  const { form, refs, dispatch } = controller;
  return (
    <>
      <section className="hero">
        <h1>Find a date that works for everyone.</h1>
        <p>
          Pick some dates, share one link, and let people answer with just a name. No login, no email, no tracking. The
          poll deletes itself after it expires.
        </p>
      </section>
      <CreatePollForm controller={controller} />
      {form.progress && (
        <CreateProgressDialog
          progress={form.progress}
          onDismiss={() => dispatch({ type: 'progressCleared' })}
          returnFocusRef={refs.titleRef}
        />
      )}
    </>
  );
}
