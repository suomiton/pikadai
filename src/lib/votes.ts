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

/** Yes and if-need-be counts per option; votes for options no longer in the poll are ignored. */
export function computeTallies(options: readonly EventOption[], participants: readonly Participant[]): Tallies {
  const tallies: Tallies = {};
  for (const o of options) tallies[o.id] = { yes: 0, maybe: 0 };
  for (const p of participants) {
    for (const [optionId, answer] of Object.entries(p.votes)) {
      const bucket = tallies[optionId];
      if (!bucket) continue;
      if (answer === 'yes') bucket.yes++;
      else if (answer === 'maybe') bucket.maybe++;
    }
  }
  return tallies;
}
