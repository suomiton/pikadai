import { useRef, type RefObject } from 'react';
import { FormError } from './FormError';
import { Modal } from './Modal';
import { StatusAnnouncer } from './StatusAnnouncer';

interface Props {
  title: string;
  description: string;
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  busyLabel,
  busy,
  error,
  onConfirm,
  onCancel,
  returnFocusRef,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Modal
      title={title}
      description={description}
      role="alertdialog"
      initialFocusRef={cancelRef}
      returnFocusRef={returnFocusRef}
      dismissible={!busy}
      onDismiss={onCancel}
    >
      <FormError message={error} />
      <StatusAnnouncer message={busy ? busyLabel : ''} />
      <div className="btn-row">
        {/* Keep the focused button in the tab order while the request finishes. */}
        <button
          ref={cancelRef}
          type="button"
          className="btn btn-secondary"
          aria-disabled={busy}
          onClick={() => {
            if (!busy) onCancel();
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-ghost danger"
          aria-disabled={busy}
          onClick={() => {
            if (!busy) onConfirm();
          }}
        >
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
