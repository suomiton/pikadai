import { FormError } from './FormError';

interface Props {
  busy: boolean;
  error: string | null;
  /** The id the name input points at when the error is about it. */
  errorId: string;
  onSave: () => void;
  onCancel: () => void;
  /** Removes the answer being edited. */
  onRemove: () => void;
  /**
   * The organiser editing someone else's row may disable or enable it; absent otherwise. `disabled` is
   * the row's current state, so the button offers the opposite.
   */
  disabling?: { disabled: boolean; onToggle: () => void };
}

/** The controls under the table while a row is being edited. */
export function EditPanel({ busy, error, errorId, onSave, onCancel, onRemove, disabling }: Props) {
  return (
    <div className="edit-panel stack">
      <p className="hint">
        Tap a cell to cycle through <span aria-hidden="true">✓ </span>yes, <span aria-hidden="true">~ </span>
        if need be, <span aria-hidden="true">✕ </span>no, and <span aria-hidden="true">· </span>no answer.
      </p>
      <FormError id={errorId} message={error} />
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={busy}>
          {busy ? 'Saving' : 'Save'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {disabling && (
          <button type="button" className="btn btn-ghost" onClick={disabling.onToggle} disabled={busy}>
            {disabling.disabled ? 'Enable' : 'Disable'}
          </button>
        )}
        <button type="button" className="btn btn-ghost danger" onClick={onRemove} disabled={busy}>
          Remove
        </button>
      </div>
    </div>
  );
}
