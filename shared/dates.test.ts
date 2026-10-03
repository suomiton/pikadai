import { describe, expect, it } from 'vitest';
import { parseIsoParts } from './dates';

describe('parseIsoParts', () => {
  it('splits YYYY-MM-DD into numbers with the month as written', () => {
    expect(parseIsoParts('2026-10-03')).toEqual([2026, 10, 3]);
  });

  it('keeps leap days intact', () => {
    expect(parseIsoParts('2024-02-29')).toEqual([2024, 2, 29]);
  });
});
