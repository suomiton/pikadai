import { describe, expect, it } from 'vitest';
import { fieldErrorsFromIssues } from './validation';

describe('fieldErrorsFromIssues', () => {
  it('keeps the first message for each field', () => {
    expect(
      fieldErrorsFromIssues([
        { path: ['title'], message: 'A title is required.' },
        { path: ['title'], message: 'The title is too long.' },
        { path: ['dates'], message: 'Choose a date.' },
      ]),
    ).toEqual({ title: 'A title is required.', dates: 'Choose a date.' });
  });

  it('uses form for an empty issue path', () => {
    expect(fieldErrorsFromIssues([{ path: [], message: 'The form is invalid.' }])).toEqual({
      form: 'The form is invalid.',
    });
  });

  it('groups fields the form does not display under the first form error', () => {
    expect(
      fieldErrorsFromIssues(
        [
          { path: ['title'], message: 'A title is required.' },
          { path: ['allowSuggestions'], message: 'Invalid suggestion setting.' },
          { path: [], message: 'Another form error.' },
        ],
        ['title', 'description', 'dates'],
      ),
    ).toEqual({ title: 'A title is required.', form: 'Invalid suggestion setting.' });
  });

  it("uses each issue's first path segment when no field list is supplied", () => {
    expect(
      fieldErrorsFromIssues([
        { path: ['dates', 0], message: 'Invalid date.' },
        { path: ['allowSuggestions'], message: 'Invalid suggestion setting.' },
      ]),
    ).toEqual({ dates: 'Invalid date.', allowSuggestions: 'Invalid suggestion setting.' });
  });
});
