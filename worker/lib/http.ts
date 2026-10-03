import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const errors = {
  badRequest: (message: string, code = 'bad_request', details?: unknown) =>
    new HttpError(400, code, message, details),
  forbidden: (message = 'Forbidden', code = 'forbidden') => new HttpError(403, code, message),
  notFound: (message = 'Not found', code = 'not_found') => new HttpError(404, code, message),
  conflict: (message: string, code = 'conflict') => new HttpError(409, code, message),
  gone: (message = 'This poll has expired and been removed', code = 'expired') =>
    new HttpError(410, code, message),
  tooMany: (message = 'Too many requests. Please slow down.', code = 'rate_limited') =>
    new HttpError(429, code, message),
  payloadTooLarge: (message = 'Request body too large', code = 'payload_too_large') =>
    new HttpError(413, code, message),
};

export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw errors.badRequest('Body must be valid JSON', 'invalid_json');
  }
}

export function parseBody<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw errors.badRequest(
      'Invalid request',
      'validation_failed',
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}
