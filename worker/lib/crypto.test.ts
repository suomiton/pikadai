import { describe, expect, it } from 'vitest';
import { base64url, hmacSign, randomId, randomToken, safeEqual, sha256Hex } from './crypto';

const base64urlToHex = (s: string) =>
  Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');

describe('base64url', () => {
  it('uses the URL-safe alphabet and no padding', () => {
    expect(base64url(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('-_-_');
    expect(base64url(new Uint8Array([1]))).toBe('AQ');
  });
});

describe('random identifiers', () => {
  it('produces 22 URL-safe characters by default and never repeats', () => {
    const a = randomId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomId()).not.toBe(a);
  });

  it('scales with the requested byte count', () => {
    expect(randomId(12)).toHaveLength(16);
  });

  it('issues 43-character tokens', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('sha256Hex', () => {
  it('matches the published test vector', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('hmacSign', () => {
  it('matches the RFC test vector', async () => {
    const sig = await hmacSign('key', 'The quick brown fox jumps over the lazy dog');
    expect(base64urlToHex(sig)).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });

  it('changes with the secret', async () => {
    expect(await hmacSign('one', 'data')).not.toBe(await hmacSign('two', 'data'));
  });
});

describe('safeEqual', () => {
  it('compares equal strings as equal', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
  });

  it('rejects different strings of equal and of different length', () => {
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
