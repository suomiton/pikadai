import type { TurnstileAction } from '@shared/types';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

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
): Promise<boolean> {
  const body = new FormData();
  body.set('secret', secret);
  body.set('response', token);
  if (remoteIp) body.set('remoteip', remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body });
    if (!res.ok) return false;
    return siteverifyPassed(await res.json(), expected);
  } catch {
    return false;
  }
}
