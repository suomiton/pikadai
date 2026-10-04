import type { Answer, EventOption, Participant } from '@shared/types';

export type Tallies = Record<string, { yes: number; maybe: number }>;

/** The order a cell moves through when tapped: no answer → yes → if need be → no → no answer. */
export function cycle(answer: Answer | undefined): Answer | undefined {
  switch (answer) {
    case undefined:
      return 'yes';
    case 'yes':
      return 'maybe';
    case 'maybe':
      return 'no';
    case 'no':
      return undefined;
  }
}

/**
 * The participants whose answers count: everyone the organiser has not disabled. Only the organiser and
 * the disabled participant themselves ever receive a disabled row.
 */
export function counted<T extends Pick<Participant, 'isDisabled'>>(participants: readonly T[]): T[] {
  return participants.filter((p) => !p.isDisabled);
}

/** Yes and if-need-be counts per option, from counted participants; votes for options no longer in the poll are ignored. */
export function computeTallies(options: readonly EventOption[], participants: readonly Participant[]): Tallies {
  const tallies: Tallies = {};
  for (const o of options) tallies[o.id] = { yes: 0, maybe: 0 };
  for (const p of counted(participants)) {
    for (const [optionId, answer] of Object.entries(p.votes)) {
      const bucket = tallies[optionId];
      if (!bucket) continue;
      if (answer === 'yes') bucket.yes++;
      else if (answer === 'maybe') bucket.maybe++;
    }
  }
  return tallies;
}

/** What a table cell shows: an answer, or `none` for a participant who left the date blank. */
export type Cell = Answer | 'none';

export const GLYPH: Record<Cell, string> = { yes: '✓', maybe: '~', no: '✕', none: '·' };
export const LABEL: Record<Cell, string> = { yes: 'Yes', maybe: 'If need be', no: 'No', none: 'No answer' };

/** How many people must have answered before the top dates say anything about the group. */
export const TOP_DATES_MIN_ANSWERS = 3;
/** How many dates the results tile shows at most. */
export const TOP_DATES_COUNT = 3;

export interface DateScore {
  option: EventOption;
  /** People who answered yes to this date. */
  yes: number;
  /** Everyone who has answered the poll, whatever they said about this date. */
  total: number;
  /** `yes` as a whole-number percentage of `total`. */
  percent: number;
}

/**
 * Whether a participant has saved an answer for at least one date. Joining creates the row before any
 * date is answered, and someone may join only to comment or change their name; until they answer, the
 * page shows them only their own row and the top dates leave them out.
 */
export function hasAnswered(participant: Pick<Participant, 'votes'>): boolean {
  return Object.keys(participant.votes).length > 0;
}

/**
 * The dates most people can make, best first: by yes answers, then if-need-be answers, then the
 * earlier date. Dates nobody said yes to are left out, so a 0-of-3 row never reads as a top date.
 * Null until TOP_DATES_MIN_ANSWERS counted people have answered; before that a single yes would top the table.
 */
export function topDates(options: readonly EventOption[], participants: readonly Participant[]): DateScore[] | null {
  const answered = counted(participants).filter(hasAnswered);
  const total = answered.length;
  if (total < TOP_DATES_MIN_ANSWERS) return null;
  // computeTallies has an entry for every option, so the lookups below never miss.
  const tallies = computeTallies(options, answered);
  return options
    .filter((o) => tallies[o.id].yes > 0)
    .sort(
      (a, b) =>
        tallies[b.id].yes - tallies[a.id].yes ||
        tallies[b.id].maybe - tallies[a.id].maybe ||
        a.date.localeCompare(b.date),
    )
    .slice(0, TOP_DATES_COUNT)
    .map((option) => {
      const { yes } = tallies[option.id];
      return { option, yes, total, percent: Math.round((yes / total) * 100) };
    });
}
