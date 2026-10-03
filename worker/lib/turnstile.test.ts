import { describe, expect, it } from 'vitest';
import { siteverifyPassed } from './turnstile';

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
