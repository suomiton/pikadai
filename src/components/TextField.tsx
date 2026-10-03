import type { ReactNode, Ref } from 'react';

interface Props {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** Shown under the control and announced with it through aria-describedby. */
  error?: string;
  /** Also under the control, on the right, and announced with it: a character count, a short explanation. */
  hint?: ReactNode;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  required?: boolean;
  /** Lets the parent move focus here, for example to the first invalid field after a submit. */
  ref?: Ref<HTMLInputElement | HTMLTextAreaElement>;
}

/** A labelled input or textarea with its error message and hint and the aria wiring between them. */
export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  multiline = false,
  rows = 3,
  maxLength,
  placeholder,
  required,
  ref,
}: Props) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  const shared = {
    id,
    className: 'input',
    value,
    maxLength,
    placeholder,
    required,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
  };
  // One ref type serves both controls; parents only call focus() on it.
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          {...shared}
          ref={ref as Ref<HTMLTextAreaElement>}
          rows={rows}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input {...shared} ref={ref as Ref<HTMLInputElement>} onChange={(e) => onChange(e.target.value)} />
      )}
      {(error || hint) && (
        <div className="field-foot">
          {error && (
            <span id={errorId} className="field-error">
              {error}
            </span>
          )}
          {hint && (
            <span id={hintId} className="field-hint">
              {hint}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
