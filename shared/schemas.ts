import { z } from 'zod';
import { parseIsoParts } from './dates';
import { LIMITS } from './limits';

function isValidCalendarDate(iso: string): boolean {
  const [y, m, d] = parseIsoParts(iso);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date like 2026-10-02')
  .refine(isValidCalendarDate, 'Not a real calendar date');

export const answerSchema = z.enum(['yes', 'no', 'maybe']);

export const nameSchema = z.string().trim().min(1, 'Name is required').max(LIMITS.nameMax);

/** The part of event creation the user fills in; validated client-side before the wait starts. */
export const eventDraftSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(LIMITS.titleMax),
  description: z.string().trim().max(LIMITS.descriptionMax).default(''),
  dates: z
    .array(isoDateSchema)
    .min(1, 'Pick at least one date')
    .max(LIMITS.optionsMax, `At most ${LIMITS.optionsMax} dates`)
    .refine((dates) => new Set(dates).size === dates.length, 'Dates must be unique'),
  allowSuggestions: z.boolean().default(true),
});

export const createEventSchema = eventDraftSchema.extend({
  ticket: z.string().min(1),
  turnstileToken: z.string().min(1),
});

export const updateEventSchema = z
  .object({
    title: z.string().trim().min(1).max(LIMITS.titleMax).optional(),
    description: z.string().trim().max(LIMITS.descriptionMax).optional(),
    allowSuggestions: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const addOptionSchema = z.object({
  date: isoDateSchema,
});

export const votesSchema = z.record(z.string().min(1).max(64), answerSchema);

/**
 * `nickname` is the field's old name. A tab loaded before the rename shipped keeps sending it until
 * the page is reloaded, so both spellings are accepted; the output always says `name`. Remove the
 * alias after 2026-11-04, when every such tab is long gone.
 */
const nameOrNickname = { name: nameSchema.optional(), nickname: nameSchema.optional() };

export const createParticipantSchema = z
  .object({ ...nameOrNickname, votes: votesSchema, turnstileToken: z.string().min(1) })
  .refine((v) => v.name !== undefined || v.nickname !== undefined, { message: 'Name is required', path: ['name'] })
  .transform(({ name, nickname, ...rest }) => ({ ...rest, name: (name ?? nickname) as string }));

/**
 * Either the name or the votes or both. A rename sends only the name and an answer only the votes, so
 * the two never overwrite each other when they cross in flight.
 */
export const updateParticipantSchema = z
  .object({ ...nameOrNickname, votes: votesSchema.optional() })
  .transform(({ name, nickname, ...rest }) => ({ ...rest, name: name ?? nickname }))
  .refine((v) => v.name !== undefined || v.votes !== undefined, 'Nothing to update');

export const createCommentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Comment is required')
    .max(LIMITS.commentMax, `At most ${LIMITS.commentMax} characters`),
});

export type EventDraft = z.infer<typeof eventDraftSchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type AddOptionInput = z.infer<typeof addOptionSchema>;
export type CreateParticipantInput = z.infer<typeof createParticipantSchema>;
export type UpdateParticipantInput = z.infer<typeof updateParticipantSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
