import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';

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
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallback = returnFocusRef?.current;
    dialog.showModal();
    (initialFocusRef?.current ?? titleRef.current)?.focus();

    return () => {
      dialog.close();
      const target = opener?.isConnected && !opener.matches(':disabled') ? opener : fallback;
      if (target?.isConnected) target.focus();
    };
  }, [initialFocusRef, returnFocusRef]);

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      role={role}
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      onKeyDown={(e) => {
        if (e.key !== 'Tab' || e.defaultPrevented) return;
        const controls = Array.from(
          e.currentTarget.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, summary, [tabindex], [contenteditable="true"]',
          ),
        ).filter(
          (element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0,
        );
        const first = controls[0];
        const last = controls.at(-1);
        const active = document.activeElement;
        const onControl = controls.some((element) => element === active);

        if (!first) {
          e.preventDefault();
          titleRef.current?.focus();
        } else if (e.shiftKey && (active === first || !onControl)) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && (active === last || !onControl)) {
          e.preventDefault();
          first.focus();
        }
      }}
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
