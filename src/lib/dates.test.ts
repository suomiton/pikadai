import { describe, expect, it } from 'vitest';
import {
  WEEKDAYS,
  WEEKDAYS_LONG,
  addDays,
  addMonths,
  formatDateLong,
  monthGrid,
  monthOf,
  parseIso,
  shiftMonth,
  toIso,
} from './dates';

describe('ISO helpers', () => {
  it('round-trips through local midnight', () => {
    const d = parseIso('2026-10-03');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 3, 0]);
    expect(toIso(d)).toBe('2026-10-03');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('adds months and clamps to the shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-15', -1)).toBe('2026-02-15');
    expect(addMonths('2026-12-10', 1)).toBe('2027-01-10');
  });
});

describe('month helpers', () => {
  it('shifts across year boundaries', () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
  });

  it('finds the month of a date', () => {
    expect(monthOf('2026-10-03')).toEqual({ year: 2026, month: 9 });
  });
});

describe('monthGrid', () => {
  it('lays October 2026 out Monday-first with padding', () => {
    const weeks = monthGrid(2026, 9);
    // 1 October 2026 is a Thursday: three empty cells first.
    expect(weeks[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter((d) => d !== null)).toHaveLength(31);
    expect(weeks.at(-1)!.at(-1)).toBeNull(); // 31 October is a Saturday, so Sunday is padding
  });

  it('starts without padding when the month begins on a Monday', () => {
    expect(monthGrid(2024, 0)[0][0]).toBe('2024-01-01');
  });
});

describe('locale labels', () => {
  it('provides seven distinct weekday names, short and long', () => {
    expect(new Set(WEEKDAYS).size).toBe(7);
    expect(new Set(WEEKDAYS_LONG).size).toBe(7);
  });

  it('spells the full date out for announcements', () => {
    const text = formatDateLong('2026-10-15');
    expect(text).toContain('2026');
    expect(text).toContain('15');
  });
});
