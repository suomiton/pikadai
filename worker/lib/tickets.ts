import { hmacSign, randomId, safeEqual } from './crypto';

/**
 * Creation tickets make the "artificial wait" real: the client asks for a
 * ticket when the user presses Create, and the Worker only accepts the event
 * once the ticket is at least MIN_CREATE_DELAY_MS old. Each ticket is
 * single-use because its nonce is stored on the event with a UNIQUE index.
 *
 * Format: `<issuedAtMs>.<nonce>.<hmac>` — all parts are base64url/digits, so
 * splitting on "." is safe.
 */
export async function issueTicket(secret: string, now = Date.now()): Promise<string> {
  const payload = `${now}.${randomId(12)}`;
  const signature = await hmacSign(secret, payload);
  return `${payload}.${signature}`;
}

export type TicketCheck =
  | { ok: true; nonce: string }
  | { ok: false; reason: 'invalid' | 'too_early' | 'expired' };

export async function verifyTicket(
  secret: string,
  ticket: string,
  minAgeMs: number,
  maxAgeMs: number,
  now = Date.now(),
): Promise<TicketCheck> {
  const parts = ticket.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'invalid' };
  const [issuedAtRaw, nonce, signature] = parts;

  const expected = await hmacSign(secret, `${issuedAtRaw}.${nonce}`);
  if (!safeEqual(expected, signature)) return { ok: false, reason: 'invalid' };

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return { ok: false, reason: 'invalid' };

  const age = now - issuedAt;
  if (age < minAgeMs) return { ok: false, reason: 'too_early' };
  if (age > maxAgeMs) return { ok: false, reason: 'expired' };

  return { ok: true, nonce };
}
