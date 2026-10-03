import { describe, expect, it } from 'vitest';
import { rateLimitKey } from './ratelimit';

describe('rateLimitKey', () => {
  it('uses an IPv4 address as the key', () => {
    expect(rateLimitKey('203.0.113.9')).toBe('203.0.113.9');
  });

  it('falls back to one shared bucket when the address is missing', () => {
    expect(rateLimitKey(null)).toBe('unknown');
  });

  it('keys an IPv6 address by its /64 prefix', () => {
    expect(rateLimitKey('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3:8d3::/64');
  });

  it('gives two addresses in the same /64 the same key', () => {
    expect(rateLimitKey('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe(
      rateLimitKey('2001:db8:85a3:8d3:ffff:ffff:ffff:ffff'),
    );
  });

  it('expands :: compression before taking the prefix', () => {
    expect(rateLimitKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(rateLimitKey('::1')).toBe('0:0:0:0::/64');
  });

  it('normalises leading zeros and letter case', () => {
    expect(rateLimitKey('2001:0DB8:0000:0000:0000:ff00:0042:8329')).toBe('2001:db8:0:0::/64');
  });

  it('keys an IPv4-mapped IPv6 address by the IPv4 address', () => {
    expect(rateLimitKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });

  it('ignores a zone index', () => {
    expect(rateLimitKey('fe80::1%en0')).toBe('fe80:0:0:0::/64');
  });

  it('passes through a string it cannot parse instead of throwing', () => {
    expect(rateLimitKey('not-an-ip:really')).toBe('not-an-ip:really');
  });
});
