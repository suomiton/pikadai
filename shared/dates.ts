/**
 * The year, month and day written in a YYYY-MM-DD string, as numbers. The month is 1–12 as
 * written, not the 0-based value `Date` uses; callers subtract one when they build a `Date`.
 * No validation: the ISO date schema in schemas.ts is where that happens.
 */
export function parseIsoParts(iso: string): [year: number, month: number, day: number] {
  const [year, month, day] = iso.split('-').map(Number);
  return [year, month, day];
}
