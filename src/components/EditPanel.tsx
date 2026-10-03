import type { TurnstileInstance } from '@marsidev/react-turnstile';
import type { Ref } from 'react';
import { FormError } from './FormError';
import { StorageNotice } from './StorageNotice';
import { TurnstileField } from './TurnstileField';

interface Props {
  /** A first answer: Turnstile is required before saving. */
  isNew: boolean;
  busy: boolean;
  canSave: boolean;
  error: string | null;
  /** The id the nickname input points at when the error is about it. */
  errorId: string;
  turnstileRef: Ref<TurnstileInstance>;
  onToken: (token: string | null) => void;
  onSave: () => void;
  onCancel: () => void;
  /** Present when an existing answer is being edited. */
  onRemove?: () => void;
}

/** The controls under the table while a row is being edited. */
export function EditPanel({
  isNew,
  busy,
  canSave,
  error,
  errorId,
  turnstileRef,
  onToken,
  onSave,
  onCancel,
  onRemove,
}: Props) {
  return (
    <div className="edit-panel stack">
      <p className="hint">
        Tap a cell to cycle through <span aria-hidden="true">✓ </span>yes, <span aria-hidden="true">~ </span>
        if need be, <span aria-hidden="true">✕ </span>no, and <span aria-hidden="true">· </span>no answer.
      </p>
      {isNew && <StorageNotice consequence="you will not be able to change this answer later from this browser." />}
      {isNew && <TurnstileField action="answer" ref={turnstileRef} onToken={onToken} />}
      <FormError id={errorId} message={error} />
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={busy || !canSave}>
          {busy ? 'Saving' : 'Save'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {onRemove && (
          <button type="button" className="btn btn-ghost danger" onClick={onRemove} disabled={busy}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
