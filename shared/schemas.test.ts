import { describe, expect, it } from 'vitest';
import { LIMITS } from './limits';
import {
  createEventSchema,
  createParticipantSchema,
  eventDraftSchema,
  isoDateSchema,
  nicknameSchema,
  updateEventSchema,
  updateParticipantSchema,
  votesSchema,
} from './schemas';

const firstMessage = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? null : result.error!.issues[0].message;

describe('isoDateSchema', () => {
  it('accepts a real calendar date', () => {
    expect(isoDateSchema.safeParse('2026-10-15').success).toBe(true);
  });

  it('rejects a date that does not exist', () => {
    expect(firstMessage(isoDateSchema.safeParse('2026-02-30'))).toBe('Not a real calendar date');
    expect(isoDateSchema.safeParse('2026-13-01').success).toBe(false);
  });

  it('rejects other formats', () => {
    expect(isoDateSchema.safeParse('15/10/2026').success).toBe(false);
    expect(isoDateSchema.safeParse('2026-10-15T00:00:00Z').success).toBe(false);
  });
});

describe('eventDraftSchema', () => {
  const valid = { title: 'Dinner', dates: ['2026-10-15'] };

  it('fills in the defaults', () => {
    expect(eventDraftSchema.parse(valid)).toEqual({
      title: 'Dinner',
      description: '',
      dates: ['2026-10-15'],
      allowSuggestions: true,
    });
  });

  it('trims the title and description', () => {
    const parsed = eventDraftSchema.parse({ ...valid, title: '  Dinner ', description: ' Bring wine ' });
    expect(parsed.title).toBe('Dinner');
    expect(parsed.description).toBe('Bring wine');
  });

  it('requires a title', () => {
    expect(firstMessage(eventDraftSchema.safeParse({ ...valid, title: '   ' }))).toBe('Title is required');
  });

  it('caps the title and description lengths', () => {
    expect(eventDraftSchema.safeParse({ ...valid, title: 'x'.repeat(LIMITS.titleMax) }).success).toBe(true);
    expect(eventDraftSchema.safeParse({ ...valid, title: 'x'.repeat(LIMITS.titleMax + 1) }).success).toBe(false);
    expect(eventDraftSchema.safeParse({ ...valid, description: 'x'.repeat(LIMITS.descriptionMax + 1) }).success).toBe(
      false,
    );
  });

  it('requires at least one date and caps the count', () => {
    expect(firstMessage(eventDraftSchema.safeParse({ ...valid, dates: [] }))).toBe('Pick at least one date');
    const many = Array.from(
      { length: LIMITS.optionsMax + 1 },
      (_, i) => `2027-01-${String((i % 28) + 1).padStart(2, '0')}`,
    );
    expect(eventDraftSchema.safeParse({ ...valid, dates: many }).success).toBe(false);
  });

  it('rejects duplicate dates', () => {
    expect(firstMessage(eventDraftSchema.safeParse({ ...valid, dates: ['2026-10-15', '2026-10-15'] }))).toBe(
      'Dates must be unique',
    );
  });
});

describe('createEventSchema', () => {
  it('also requires the ticket and the Turnstile token', () => {
    const draft = { title: 'Dinner', dates: ['2026-10-15'] };
    expect(createEventSchema.safeParse(draft).success).toBe(false);
    expect(createEventSchema.safeParse({ ...draft, ticket: 't', turnstileToken: '' }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...draft, ticket: 't', turnstileToken: 'x' }).success).toBe(true);
  });
});

describe('updateEventSchema', () => {
  it('rejects an empty patch', () => {
    expect(firstMessage(updateEventSchema.safeParse({}))).toBe('Nothing to update');
  });

  it('accepts a partial patch', () => {
    expect(updateEventSchema.parse({ allowSuggestions: false })).toEqual({ allowSuggestions: false });
  });
});

describe('nicknameSchema', () => {
  it('trims and bounds the length', () => {
    expect(nicknameSchema.parse('  Ada ')).toBe('Ada');
    expect(firstMessage(nicknameSchema.safeParse('   '))).toBe('Nickname is required');
    expect(nicknameSchema.safeParse('x'.repeat(LIMITS.nicknameMax + 1)).success).toBe(false);
  });
});

describe('votesSchema', () => {
  it('accepts a map of option ids to answers', () => {
    expect(votesSchema.parse({ abc: 'yes', def: 'maybe', ghi: 'no' })).toEqual({ abc: 'yes', def: 'maybe', ghi: 'no' });
  });

  it('rejects unknown answers and oversized keys', () => {
    expect(votesSchema.safeParse({ abc: 'perhaps' }).success).toBe(false);
    expect(votesSchema.safeParse({ ['k'.repeat(65)]: 'yes' }).success).toBe(false);
  });
});

describe('participant schemas', () => {
  it('requires a Turnstile token only when creating', () => {
    expect(createParticipantSchema.safeParse({ nickname: 'Ada', votes: {} }).success).toBe(false);
    expect(createParticipantSchema.safeParse({ nickname: 'Ada', votes: {}, turnstileToken: 'x' }).success).toBe(true);
    expect(updateParticipantSchema.safeParse({ votes: {} }).success).toBe(true);
  });
});
