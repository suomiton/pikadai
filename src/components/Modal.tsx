import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

interface Props {
  title: string;
  description?: string;
  children: ReactNode;
  role?: 'dialog' | 'alertdialog';
  dismissible?: boolean;
  onDismiss: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Used when the opener has been removed or disabled by the completed action. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

const focusableControls = (dialog: HTMLDialogElement) =>
  Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, summary, [tabindex], [contenteditable="true"]',
    ),
  ).filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);

const trapTabKey = (e: KeyboardEvent<HTMLDialogElement>, fallback: HTMLElement | null) => {
  if (e.key !== 'Tab' || e.defaultPrevented) return;
  const controls = focusableControls(e.currentTarget);
  const first = controls[0];
  const last = controls.at(-1);
  const active = document.activeElement;
  const onControl = controls.some((element) => element === active);
  if (!first) {
    e.preventDefault();
    fallback?.focus();
  } else if (e.shiftKey && (active === first || !onControl)) {
    e.preventDefault();
    last?.focus();
  } else if (!e.shiftKey && (active === last || !onControl)) {
    e.preventDefault();
    first.focus();
  }
};

const showDialog = (dialog: HTMLDialogElement, initialFocus: HTMLElement | null, fallback?: HTMLElement | null) => {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.showModal();
  initialFocus?.focus();
  return () => {
    dialog.close();
    const target = opener?.isConnected && !opener.matches(':disabled') ? opener : fallback;
    if (target?.isConnected) target.focus();
  };
};

/** Mount to open, unmount to close. showModal() makes the rest of the page inert. */
export function Modal({
  title,
  description,
  children,
  role = 'dialog',
  dismissible = true,
  onDismiss,
  initialFocusRef,
  returnFocusRef,
}: Props) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    return showDialog(dialog, initialFocusRef?.current ?? titleRef.current, returnFocusRef?.current);
  }, [initialFocusRef, returnFocusRef]);

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      role={role}
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      onKeyDown={(e) => trapTabKey(e, titleRef.current)}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onDismiss();
      }}
    >
      <div className="card modal-card stack">
        <h2 ref={titleRef} id={`${id}-title`} tabIndex={-1}>
          {title}
        </h2>
        {description && <p id={`${id}-description`}>{description}</p>}
        {children}
      </div>
    </dialog>
  );
}
