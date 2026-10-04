import { hmacSign, randomId, safeEqual } from './crypto';

/**
 * Creation tickets make the "artificial wait" real: the client asks for a
 * ticket when the user presses Create, and the Worker only accepts the event
 * once the ticket is at least `minAgeMs` old. Each ticket is single-use
 * because its nonce is stored on the event with a UNIQUE index.
 *
 * The signature also covers `bind`, the rate-limit key of the client that
 * asked for the ticket, so a ticket harvested from one network cannot be
 * spent from another. The binding is never written into the ticket itself.
 *
 * Format: `<issuedAtMs>.<nonce>.<hmac>`. The first two parts are digits and
 * base64url, so splitting on "." is safe.
 */
export async function issueTicket(secret: string, bind: string, now = Date.now()): Promise<string> {
  const issuedAt = String(now);
  const nonce = randomId(12);
  const signature = await hmacSign(secret, signedPayload(issuedAt, nonce, bind));
  return `${issuedAt}.${nonce}.${signature}`;
}

export type TicketCheck = { ok: true; nonce: string } | { ok: false; reason: 'invalid' | 'too_early' | 'expired' };

export interface TicketRules {
  /** Rate-limit key of the client presenting the ticket; must match the one it was issued to. */
  bind: string;
  minAgeMs: number;
  maxAgeMs: number;
  now?: number;
}

export async function verifyTicket(
  secret: string,
  ticket: string,
  { bind, minAgeMs, maxAgeMs, now = Date.now() }: TicketRules,
): Promise<TicketCheck> {
  const parts = ticket.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'invalid' };
  const [issuedAtRaw, nonce, signature] = parts;

  const expected = await hmacSign(secret, signedPayload(issuedAtRaw, nonce, bind));
  if (!safeEqual(expected, signature)) return { ok: false, reason: 'invalid' };

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return { ok: false, reason: 'invalid' };

  const age = now - issuedAt;
  if (age < minAgeMs) return { ok: false, reason: 'too_early' };
  if (age > maxAgeMs) return { ok: false, reason: 'expired' };

  return { ok: true, nonce };
}

const signedPayload = (issuedAt: string, nonce: string, bind: string): string => {
  return `${issuedAt}.${nonce}.${bind}`;
};
