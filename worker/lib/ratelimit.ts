import type { Context, MiddlewareHandler } from 'hono';
import { errors } from './http';
import type { AppEnv } from '../env';

/**
 * The client IP is used only as an in-memory rate-limit key.
 * It is never written to the database or to logs.
 */
export function clientIp(c: Context<AppEnv>): string | null {
  return (
    c.req.header('CF-Connecting-IP') ??
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
    null
  );
}

export function rateLimit(pick: (env: Env) => RateLimit): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = clientIp(c) ?? 'unknown';
    const { success } = await pick(c.env).limit({ key });
    if (!success) throw errors.tooMany();
    await next();
  };
}
