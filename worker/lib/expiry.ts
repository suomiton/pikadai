import { parseIsoParts } from '@shared/dates';
import { LIMITS } from '@shared/limits';

const DAY_MS = 24 * 60 * 60 * 1000;

/** End of the last date option plus a grace period, or a fixed TTL when there are no dates. */
export function computeExpiresAt(dates: readonly string[], createdAt: number): number {
  if (dates.length === 0) return createdAt + LIMITS.ttlWithoutDatesDays * DAY_MS;
  const last = [...dates].sort().at(-1)!;
  const [y, m, d] = parseIsoParts(last);
  const endOfLastDay = Date.UTC(y, m - 1, d + 1); // midnight after the last date, UTC
  return endOfLastDay + LIMITS.ttlAfterLastDateDays * DAY_MS;
}
