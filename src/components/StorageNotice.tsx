import { storage } from '../lib/storage';

/** Probed once per page load: whether localStorage keeps what the app writes. */
const persists = storage.available();

interface Props {
  /** What the viewer loses, completing "This browser is not saving site data, so …". */
  consequence: string;
}

/**
 * Shown where a credential is handed to the browser (the admin link, a first answer) when storage
 * is blocked. The poll still works in this tab, but nothing will be remembered after it closes.
 */
export function StorageNotice({ consequence }: Props) {
  if (persists) return null;
  return (
    <p className="notice" role="note">
      This browser is not saving site data, so {consequence}
    </p>
  );
}
