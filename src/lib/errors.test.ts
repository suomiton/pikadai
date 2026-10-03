import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api';
import { describeError } from './errors';

/** Every code the Worker can emit; see the API reference in docs/architecture.md. */
const WORKER_CODES = [
  'invalid_json',
  'validation_failed',
  'payload_too_large',
  'captcha_failed',
  'verification_unavailable',
  'ticket_invalid',
  'ticket_too_early',
  'ticket_expired',
  'ticket_used',
  'rate_limited',
  'not_found',
  'expired',
  'admin_required',
  'suggestions_disabled',
  'too_many_options',
  'date_exists',
  'event_full',
  'nickname_taken',
  'unknown_option',
  'not_owner',
  'not_participant',
  'too_many_comments',
  'comment_too_soon',
  'internal',
];

describe('describeError', () => {
  it('has user-facing copy for every Worker error code', () => {
    const missing = WORKER_CODES.filter(
      (code) => describeError(new ApiRequestError(400, code, 'raw server text')) === 'raw server text',
    );
    expect(missing).toEqual([]);
  });

  it('falls back to the server message for an unknown code', () => {
    expect(describeError(new ApiRequestError(418, 'teapot', 'I am a teapot'))).toBe('I am a teapot');
  });

  it('explains network failures', () => {
    expect(describeError(new TypeError('Failed to fetch'))).toMatch(/network/i);
  });

  it('passes other errors through and has a last resort', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('???')).toBe('Something went wrong.');
  });
});
