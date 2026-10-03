import { parseIsoParts } from '@shared/dates';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD. */
export function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayIso(): string {
  return toIso(new Date());
}

/** Parse YYYY-MM-DD as local midnight. */
export function parseIso(iso: string): Date {
  const [y, m, d] = parseIsoParts(iso);
  return new Date(y, m - 1, d);
}

/** The ISO date `days` days after `iso` (negative moves back). */
export function addDays(iso: string, days: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

/** The same day of the month `months` months away, clamped to the length of that month. */
export function addMonths(iso: string, months: number): string {
  const d = parseIso(iso);
  const first = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return toIso(new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last)));
}

/** Weekday names, Monday first, in the user's locale. 2024-01-01 was a Monday. */
function weekdayNames(weekday: 'short' | 'long'): readonly string[] {
  const fmt = new Intl.DateTimeFormat(undefined, { weekday });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)));
}

export const WEEKDAYS = weekdayNames('short');
export const WEEKDAYS_LONG = weekdayNames('long');

export interface MonthCursor {
  year: number;
  month: number; // 0-11
}

export function shiftMonth({ year, month }: MonthCursor, delta: number): MonthCursor {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** The month an ISO date belongs to. */
export function monthOf(iso: string): MonthCursor {
  const d = parseIso(iso);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** Weeks (Monday-first) of ISO dates for a month, padded with null. */
export function monthGrid(year: number, month: number): Array<Array<string | null>> {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;

  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(toIso(new Date(year, month, day)));
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: Array<Array<string | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function formatDate(
  iso: string,
  options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' },
): string {
  return new Intl.DateTimeFormat(undefined, options).format(parseIso(iso));
}

/** Unabbreviated date for screen-reader labels and announcements, e.g. "Thursday 15 October 2026". */
export function formatDateLong(iso: string): string {
  return formatDate(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatMonth({ year, month }: MonthCursor): string {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
}

export function formatTimestamp(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(ms));
}

/** Date and time in the viewer's locale and zone, e.g. "3 Oct 2026, 14:02"; for comments. */
export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
}
