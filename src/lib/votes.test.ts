import { describe, expect, it } from 'vitest';
import type { EventOption, Participant } from '@shared/types';
import { computeTallies, cycle } from './votes';

describe('cycle', () => {
  it('walks no answer → yes → if need be → no → no answer', () => {
    expect(cycle(undefined)).toBe('yes');
    expect(cycle('yes')).toBe('maybe');
    expect(cycle('maybe')).toBe('no');
    expect(cycle('no')).toBeUndefined();
  });
});

describe('computeTallies', () => {
  const options: EventOption[] = [
    { id: 'a', date: '2026-10-15', suggestedBy: null },
    { id: 'b', date: '2026-10-16', suggestedBy: null },
  ];
  const participant = (id: string, votes: Participant['votes']): Participant => ({
    id,
    nickname: id,
    votes,
    createdAt: 0,
  });

  it('counts yes and if-need-be answers per date', () => {
    const tallies = computeTallies(options, [
      participant('p1', { a: 'yes', b: 'maybe' }),
      participant('p2', { a: 'yes', b: 'no' }),
      participant('p3', { a: 'maybe' }),
    ]);
    expect(tallies).toEqual({ a: { yes: 2, maybe: 1 }, b: { yes: 0, maybe: 1 } });
  });

  it('starts every date at zero and ignores votes for dates no longer in the poll', () => {
    expect(computeTallies(options, [participant('p1', { gone: 'yes' })])).toEqual({
      a: { yes: 0, maybe: 0 },
      b: { yes: 0, maybe: 0 },
    });
  });
});
