import type { Context, MiddlewareHandler } from 'hono';
import { errors } from './http';
import type { AppEnv } from '../env';

/**
 * The client IP is used only as an in-memory rate-limit key and as the binding
 * for creation tickets. The Worker itself never stores or logs it; what the
 * platform retains is described in docs/cloudflare.md under Observability.
 *
 * Only `CF-Connecting-IP` is trusted. Cloudflare sets it on every request, and
 * anything else, such as `X-Forwarded-For`, could be supplied by the client.
 */
export function clientIp(c: Context<AppEnv>): string | null {
  return c.req.header('CF-Connecting-IP') ?? null;
}

/**
 * Rate-limit key for an address. IPv4 addresses are used as they are. An IPv6
 * subscriber usually controls a whole /64, so those are keyed by that prefix;
 * keying on the full address would hand one connection an unlimited number of
 * keys. Anything that does not parse is used verbatim rather than failing open.
 */
export function rateLimitKey(ip: string | null): string {
  if (!ip) return 'unknown';
  if (!ip.includes(':')) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  const hextets = expandIpv6(ip);
  return hextets ? `${hextets.slice(0, 4).join(':')}::/64` : ip;
}

/** Expand an IPv6 address into eight normalised hextets, or null if it does not parse. */
function expandIpv6(address: string): string[] | null {
  const halves = address.split('%')[0].toLowerCase().split('::');
  if (halves.length > 2) return null;
  const head = parseGroups(halves[0]);
  const tail = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...head, ...Array<string>(missing).fill('0'), ...tail];
}

/** Colon-separated groups with leading zeros dropped; a trailing dotted quad becomes two hextets. */
function parseGroups(part: string): string[] | null {
  if (part === '') return [];
  const groups = part.split(':');
  const last = groups.at(-1)!;
  if (last.includes('.')) {
    const octets = last.split('.').map(Number);
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    groups.splice(-1, 1, (octets[0] * 256 + octets[1]).toString(16), (octets[2] * 256 + octets[3]).toString(16));
  }
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.replace(/^0+(?=.)/, ''));
}

export function rateLimit(pick: (env: Env) => RateLimit): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = rateLimitKey(clientIp(c));
    const { success } = await pick(c.env).limit({ key });
    if (!success) throw errors.tooMany();
    await next();
  };
}
