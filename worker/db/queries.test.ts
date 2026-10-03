import { describe, expect, it } from 'vitest';
import { LIMITS } from '@shared/limits';
import { computeExpiresAt } from './queries';

const DAY = 24 * 60 * 60 * 1000;
const createdAt = Date.UTC(2026, 9, 3, 12, 0, 0);

describe('computeExpiresAt', () => {
  it('uses a fixed TTL from creation when there are no dates', () => {
    expect(computeExpiresAt([], createdAt)).toBe(createdAt + LIMITS.ttlWithoutDatesDays * DAY);
  });

  it('expires 30 days after midnight UTC following the last date', () => {
    // The example from docs/database.md.
    expect(computeExpiresAt(['2026-11-21'], createdAt)).toBe(Date.UTC(2026, 11, 22));
  });

  it('picks the latest date regardless of input order', () => {
    expect(computeExpiresAt(['2026-11-28', '2026-11-21'], createdAt)).toBe(Date.UTC(2026, 11, 29));
  });

  it('does not depend on the creation time once there are dates', () => {
    expect(computeExpiresAt(['2026-11-21'], createdAt)).toBe(computeExpiresAt(['2026-11-21'], createdAt + 5 * DAY));
  });
});
