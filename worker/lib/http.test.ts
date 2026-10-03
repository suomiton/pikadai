import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errors, HttpError, isUniqueViolation, parseBody } from './http';

describe('parseBody', () => {
  const schema = z.object({ name: z.string().min(1, 'Name is required'), age: z.number().int() });

  it('returns the parsed data', () => {
    expect(parseBody(schema, { name: 'Ada', age: 36 })).toEqual({ name: 'Ada', age: 36 });
  });

  it('throws a 400 with one detail per issue', () => {
    let caught: unknown;
    try {
      parseBody(schema, { name: '', age: 1.5 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpError);
    const err = caught as HttpError;
    expect(err.status).toBe(400);
    expect(err.code).toBe('validation_failed');
    expect(err.details).toEqual([
      { path: 'name', message: 'Name is required' },
      { path: 'age', message: expect.any(String) },
    ]);
  });
});

describe('isUniqueViolation', () => {
  it('recognises the D1 message', () => {
    expect(isUniqueViolation(new Error('D1_ERROR: UNIQUE constraint failed: participants.name'))).toBe(true);
  });

  it('ignores other errors and non-errors', () => {
    expect(isUniqueViolation(new Error('FOREIGN KEY constraint failed'))).toBe(false);
    expect(isUniqueViolation('UNIQUE constraint failed')).toBe(false);
  });
});

describe('error constructors', () => {
  it('carry the status and code the client maps on', () => {
    expect(errors.payloadTooLarge()).toMatchObject({ status: 413, code: 'payload_too_large' });
    expect(errors.tooMany()).toMatchObject({ status: 429, code: 'rate_limited' });
    expect(errors.gone()).toMatchObject({ status: 410, code: 'expired' });
    expect(errors.forbidden('Admin link required', 'admin_required')).toMatchObject({
      status: 403,
      code: 'admin_required',
    });
    expect(errors.badRequest('Bad', 'custom', [{ path: 'x' }])).toMatchObject({
      status: 400,
      code: 'custom',
      details: [{ path: 'x' }],
    });
  });
});
