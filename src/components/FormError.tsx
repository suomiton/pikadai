interface Props {
  message: string | null | undefined;
  /** Set when a control points at this message through aria-describedby. */
  id?: string;
}

/** The form-level error paragraph; renders nothing when there is no message. */
export function FormError({ message, id }: Props) {
  if (!message) return null;
  return (
    <p id={id} className="form-error" role="alert">
      {message}
    </p>
  );
}
