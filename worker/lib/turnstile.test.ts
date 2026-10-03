import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteverifyPassed, verifyTurnstile } from './turnstile';

const expected = { hostname: 'pikadai.example', action: 'create' };

describe('siteverifyPassed', () => {
  it('accepts a success for the expected hostname and action', () => {
    const data = { success: true, hostname: 'pikadai.example', action: 'create' };
    expect(siteverifyPassed(data, expected)).toBe(true);
  });

  it('rejects an unsuccessful response', () => {
    const data = { success: false, 'error-codes': ['invalid-input-response'] };
    expect(siteverifyPassed(data, expected)).toBe(false);
  });

  it('rejects a token solved on another hostname', () => {
    const data = { success: true, hostname: 'evil.example', action: 'create' };
    expect(siteverifyPassed(data, expected)).toBe(false);
  });

  it('rejects a token solved for another action', () => {
    const data = { success: true, hostname: 'pikadai.example', action: 'answer' };
    expect(siteverifyPassed(data, expected)).toBe(false);
  });

  it('rejects a success that carries no hostname or action', () => {
    expect(siteverifyPassed({ success: true }, expected)).toBe(false);
  });

  it('compares hostnames case-insensitively', () => {
    const data = { success: true, hostname: 'Pikadai.Example', action: 'create' };
    expect(siteverifyPassed(data, expected)).toBe(true);
  });

  it("skips the hostname and action checks for Cloudflare's testing keys", () => {
    // The published test secret always answers with hostname "example.com" and no action.
    const data = { success: true, hostname: 'example.com', metadata: { result_with_testing_key: true } };
    expect(siteverifyPassed(data, expected)).toBe(true);
  });

  it('still rejects a failure from a testing key', () => {
    const data = { success: false, metadata: { result_with_testing_key: true } };
    expect(siteverifyPassed(data, expected)).toBe(false);
  });

  it('rejects a body that is not an object', () => {
    expect(siteverifyPassed(null, expected)).toBe(false);
    expect(siteverifyPassed('ok', expected)).toBe(false);
  });
});

describe('verifyTurnstile', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is ok for an accepted token and rejected for a refused one', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ success: true, hostname: 'pikadai.example', action: 'create' }));
    await expect(verifyTurnstile('secret', 'tok', '203.0.113.1', expected)).resolves.toBe('ok');
    vi.stubGlobal('fetch', async () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] }));
    await expect(verifyTurnstile('secret', 'tok', null, expected)).resolves.toBe('rejected');
  });

  it('is unavailable when siteverify answers with an error or cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => new Response('bad gateway', { status: 502 }));
    await expect(verifyTurnstile('secret', 'tok', null, expected)).resolves.toBe('unavailable');
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(verifyTurnstile('secret', 'tok', null, expected)).resolves.toBe('unavailable');
  });

  it('gives up when siteverify does not answer in time', async () => {
    // A fetch that only ends when its signal fires, as a hung connection would.
    vi.stubGlobal(
      'fetch',
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
        }),
    );
    await expect(verifyTurnstile('secret', 'tok', null, expected, 20)).resolves.toBe('unavailable');
  });
});
