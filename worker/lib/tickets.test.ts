import { describe, expect, it } from 'vitest';
import { issueTicket, verifyTicket } from './tickets';

const SECRET = 'test-secret';
const T0 = 1_700_000_000_000;
const rules = { minAgeMs: 5000, maxAgeMs: 15 * 60 * 1000 };

describe('creation tickets', () => {
  it('accepts a ticket from the client it was issued to once it is old enough', async () => {
    const ticket = await issueTicket(SECRET, 'client-a', T0);
    const result = await verifyTicket(SECRET, ticket, { ...rules, bind: 'client-a', now: T0 + 5000 });
    expect(result).toEqual({ ok: true, nonce: expect.any(String) });
  });

  it('rejects a ticket spent from a different client than it was issued to', async () => {
    const ticket = await issueTicket(SECRET, 'client-a', T0);
    const result = await verifyTicket(SECRET, ticket, { ...rules, bind: 'client-b', now: T0 + 5000 });
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects a ticket that is too young', async () => {
    const ticket = await issueTicket(SECRET, 'client-a', T0);
    const result = await verifyTicket(SECRET, ticket, { ...rules, bind: 'client-a', now: T0 + 4999 });
    expect(result).toEqual({ ok: false, reason: 'too_early' });
  });

  it('rejects a ticket older than the maximum age', async () => {
    const ticket = await issueTicket(SECRET, 'client-a', T0);
    const result = await verifyTicket(SECRET, ticket, {
      ...rules,
      bind: 'client-a',
      now: T0 + rules.maxAgeMs + 1,
    });
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a ticket whose timestamp was edited', async () => {
    const ticket = await issueTicket(SECRET, 'client-a', T0);
    const [, nonce, signature] = ticket.split('.');
    const forged = `${T0 - 60_000}.${nonce}.${signature}`;
    const result = await verifyTicket(SECRET, forged, { ...rules, bind: 'client-a', now: T0 + 5000 });
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects a ticket signed with another secret', async () => {
    const ticket = await issueTicket('other-secret', 'client-a', T0);
    const result = await verifyTicket(SECRET, ticket, { ...rules, bind: 'client-a', now: T0 + 5000 });
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects malformed input', async () => {
    const result = await verifyTicket(SECRET, 'not.a.real.ticket', { ...rules, bind: 'client-a', now: T0 });
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });
});
