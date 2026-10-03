import { useCallback, useState } from 'react';
import { describeError } from '../lib/errors';

export interface AsyncAction {
  /** A request is in flight; disable the buttons that could start another. */
  busy: boolean;
  /** The user-facing message from the last failure, or a validation message set by the caller. */
  error: string | null;
  /** For failures that never reach the network, such as a missing name; null clears. */
  setError: (message: string | null) => void;
  /**
   * Run one request. Clears the error, holds `busy` until it settles, and keeps the failure
   * message. Resolves to whether it succeeded so the caller can, say, reset Turnstile on failure.
   */
  run: (fn: () => Promise<void>) => Promise<boolean>;
}

/** The busy / error pair every mutation needs, so components stop writing try/catch/finally. */
export function useAsyncAction(): AsyncAction {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(describeError(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, setError, run };
}
