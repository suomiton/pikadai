import { describe, expect, it } from 'vitest';
import { client } from './helpers';

/** The create limiter allows five per minute; the sixth attempt from the same client is refused. */
const sixCreates = async (ips: string[], extraHeaders: (i: number) => Record<string, string> = () => ({})) => {
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    const c = client(ips[i % ips.length]);
    statuses.push((await c.post('/api/events', {}, extraHeaders(i))).status);
  }
  return statuses;
};

describe('rate limiting', () => {
  it('limits poll creation per client and answers 429 with the usual headers', async () => {
    const ip = '198.51.100.10';
    expect(await sixCreates([ip])).toEqual([400, 400, 400, 400, 400, 429]);
    const res = await client(ip).post('/api/events', {});
    expect(res.body).toMatchObject({ code: 'rate_limited' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('counts every address in one IPv6 /64 as the same client', async () => {
    const ips = Array.from({ length: 6 }, (_, i) => `2001:db8:cafe:1::${i + 1}`);
    expect(await sixCreates(ips)).toEqual([400, 400, 400, 400, 400, 429]);
    expect((await client('2001:db8:cafe:2::1').post('/api/events', {})).status).toBe(400);
  });

  it('ignores X-Forwarded-For when picking the bucket', async () => {
    const statuses = await sixCreates(['198.51.100.20'], (i) => ({ 'X-Forwarded-For': `10.9.8.${i}` }));
    expect(statuses.at(-1)).toBe(429);
  });

  it('keeps reads out of the create bucket', async () => {
    const ip = '198.51.100.30';
    await sixCreates([ip]);
    expect((await client(ip).get('/api/events/nope00000000000000000000')).status).toBe(404);
  });
});
