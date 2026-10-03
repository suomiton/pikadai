interface Props {
  message: string;
}

/**
 * A visually hidden live region. Screen readers announce each new message; sighted users see
 * nothing. Use it for changes that are otherwise silent: saves, removals, copied links.
 */
export function StatusAnnouncer({ message }: Props) {
  return (
    <p className="visually-hidden" role="status">
      {message}
    </p>
  );
}
