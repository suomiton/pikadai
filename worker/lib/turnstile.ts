import type { TurnstileAction } from '@shared/types';
import { errors } from './http';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** How long a siteverify call may take before the submission is refused as retryable. */
export const SITEVERIFY_TIMEOUT_MS = 5000;

/** The token passed; Cloudflare refused it; or Cloudflare could not be asked (timeout, outage). */
export type TurnstileOutcome = 'ok' | 'rejected' | 'unavailable';

export interface TurnstileExpectations {
  /** Hostname of the page the challenge must have been solved on. */
  hostname: string;
  /** The `action` the widget was rendered with (`create` or `answer`). */
  action: string;
}

interface SiteverifyResponse {
  success?: boolean;
  hostname?: string;
  action?: string;
  'error-codes'?: string[];
  metadata?: { result_with_testing_key?: boolean };
}

/**
 * Decide whether a siteverify response proves that this widget was solved on
 * this site. `success` alone would accept a token solved on any hostname bound
 * to the widget, for any purpose. Cloudflare's published testing secrets always
 * answer with hostname "example.com" and no action, and flag that with
 * `metadata.result_with_testing_key`, so the two binding checks are skipped
 * for them; a testing secret in production already accepts everything anyway.
 */
export function siteverifyPassed(data: unknown, expected: TurnstileExpectations): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const res = data as SiteverifyResponse;
  if (res.success !== true) return false;
  if (res.metadata?.result_with_testing_key === true) return true;
  return (
    typeof res.hostname === 'string' &&
    res.hostname.toLowerCase() === expected.hostname.toLowerCase() &&
    res.action === expected.action
  );
}

/** What a token sent to `requestUrl` must have been solved for. */
export function turnstileExpectations(requestUrl: string, action: TurnstileAction): TurnstileExpectations {
  return { hostname: new URL(requestUrl).hostname, action };
}

export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string | null,
  expected: TurnstileExpectations,
  timeoutMs = SITEVERIFY_TIMEOUT_MS,
): Promise<TurnstileOutcome> {
  const body = new FormData();
  body.set('secret', secret);
  body.set('response', token);
  if (remoteIp) body.set('remoteip', remoteIp);

  try {
    // Bounded: a hung connection to siteverify must not hold the user's submission open indefinitely.
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return 'unavailable';
    return siteverifyPassed(await res.json(), expected) ? 'ok' : 'rejected';
  } catch {
    // Timed out, unreachable or an unreadable body: Cloudflare could not be asked, which is not the user's fault.
    return 'unavailable';
  }
}

/**
 * Verify, and turn anything but a pass into the HTTP error the client knows: 403 `captcha_failed`
 * for a refused token, 503 `verification_unavailable` when the check itself could not be made.
 */
export async function requireHuman(
  secret: string,
  token: string,
  remoteIp: string | null,
  expected: TurnstileExpectations,
): Promise<void> {
  const outcome = await verifyTurnstile(secret, token, remoteIp, expected);
  if (outcome === 'unavailable') throw errors.unavailable();
  if (outcome === 'rejected') throw errors.forbidden('Verification failed, please try again', 'captcha_failed');
}
