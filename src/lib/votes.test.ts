import { describe, expect, it } from 'vitest';
import type { EventOption, Participant } from '@shared/types';
import { computeTallies, counted, cycle, hasAnswered, topDates } from './votes';

const option = (id: string, date: string): EventOption => ({ id, date, suggestedBy: null });
const participant = (id: string, votes: Participant['votes']): Participant => ({
  id,
  name: id,
  votes,
  createdAt: 0,
  isOrganiser: false,
  isDisabled: false,
});

describe('cycle', () => {
  it('walks no answer → yes → if need be → no → no answer', () => {
    expect(cycle(undefined)).toBe('yes');
    expect(cycle('yes')).toBe('maybe');
    expect(cycle('maybe')).toBe('no');
    expect(cycle('no')).toBeUndefined();
  });
});

describe('computeTallies', () => {
  const options = [option('a', '2026-10-15'), option('b', '2026-10-16')];

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

  it('leaves out disabled participants', () => {
    const tallies = computeTallies(options, [
      participant('p1', { a: 'yes', b: 'maybe' }),
      { ...participant('p2', { a: 'yes', b: 'maybe' }), isDisabled: true },
    ]);
    expect(tallies).toEqual({ a: { yes: 1, maybe: 0 }, b: { yes: 0, maybe: 1 } });
  });
});

describe('counted', () => {
  it('keeps everyone the organiser has not disabled', () => {
    const ada = participant('p1', {});
    const bea = { ...participant('p2', {}), isDisabled: true };
    expect(counted([ada, bea])).toEqual([ada]);
  });
});

describe('hasAnswered', () => {
  it('is true once any date has an answer, including no', () => {
    expect(hasAnswered({ votes: {} })).toBe(false);
    expect(hasAnswered({ votes: { a: 'no' } })).toBe(true);
    expect(hasAnswered({ votes: { a: 'yes', b: 'maybe' } })).toBe(true);
  });
});

describe('topDates', () => {
  const options = [
    option('a', '2026-10-15'),
    option('b', '2026-10-16'),
    option('c', '2026-10-17'),
    option('d', '2026-10-18'),
  ];

  it('is null until three people have answered', () => {
    expect(topDates(options, [])).toBeNull();
    expect(topDates(options, [participant('p1', { a: 'yes' }), participant('p2', { a: 'yes' })])).toBeNull();
  });

  it('ranks dates by yes answers and keeps the top three', () => {
    const scores = topDates(options, [
      participant('p1', { a: 'yes', b: 'yes', c: 'yes', d: 'yes' }),
      participant('p2', { a: 'no', b: 'yes', c: 'yes', d: 'yes' }),
      participant('p3', { a: 'no', b: 'no', c: 'yes', d: 'yes' }),
      participant('p4', { d: 'yes' }),
    ]);
    expect(scores?.map((s) => s.option.id)).toEqual(['d', 'c', 'b']);
  });

  it('counts everyone who answered as the total and rounds the share to a whole percent', () => {
    const scores = topDates(options, [
      participant('p1', { a: 'yes', b: 'yes' }),
      participant('p2', { a: 'yes', b: 'no' }),
      participant('p3', { b: 'maybe' }),
    ]);
    expect(scores).toEqual([
      { option: options[0], yes: 2, total: 3, percent: 67 },
      { option: options[1], yes: 1, total: 3, percent: 33 },
    ]);
  });

  it('breaks a tie on yes answers by if-need-be answers, then by the earlier date', () => {
    // The dates arrive latest first, so the order below has to come from the ranking, not the input.
    const scores = topDates([...options].reverse(), [
      participant('p1', { a: 'yes', b: 'yes', c: 'yes' }),
      participant('p2', { c: 'maybe' }),
      participant('p3', { d: 'no' }),
    ]);
    expect(scores?.map((s) => s.option.id)).toEqual(['c', 'a', 'b']);
  });

  it('leaves out dates nobody said yes to', () => {
    const scores = topDates(options, [
      participant('p1', { a: 'yes', b: 'no' }),
      participant('p2', { b: 'maybe' }),
      participant('p3', { b: 'no' }),
    ]);
    expect(scores?.map((s) => s.option.id)).toEqual(['a']);
  });

  it('is empty when three people have answered and no date has a yes', () => {
    const scores = topDates(options, [
      participant('p1', { a: 'no' }),
      participant('p2', { a: 'maybe' }),
      participant('p3', { b: 'no' }),
    ]);
    expect(scores).toEqual([]);
  });

  it('ignores someone who joined but has not answered any date', () => {
    const answered = [participant('p1', { a: 'yes' }), participant('p2', { a: 'yes' })];
    expect(topDates(options, [...answered, participant('p3', {})])).toBeNull();
    const scores = topDates(options, [...answered, participant('p3', { a: 'no' }), participant('p4', {})]);
    expect(scores).toEqual([{ option: options[0], yes: 2, total: 3, percent: 67 }]);
  });

  it('leaves out disabled participants, both from the dates and from the total', () => {
    const answered = [
      participant('p1', { a: 'yes' }),
      participant('p2', { a: 'yes' }),
      participant('p3', { b: 'yes' }),
    ];
    const disabled = { ...participant('p4', { b: 'yes' }), isDisabled: true };
    expect(topDates(options, [...answered.slice(0, 2), disabled])).toBeNull();
    expect(topDates(options, [...answered, disabled])).toEqual([
      { option: options[0], yes: 2, total: 3, percent: 67 },
      { option: options[1], yes: 1, total: 3, percent: 33 },
    ]);
  });
});
