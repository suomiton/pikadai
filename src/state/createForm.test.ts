import { describe, expect, it } from 'vitest';
import { createFormReducer, firstInvalidField, initialCreateForm, type CreateFormState } from './createForm';

const withProgress = (state: CreateFormState, step: number): CreateFormState =>
  createFormReducer(state, { type: 'progress', step });

describe('createFormReducer', () => {
  it('toggles a date in and out of the selection without touching the others', () => {
    const one = createFormReducer(initialCreateForm, { type: 'toggleDate', iso: '2026-10-15' });
    const two = createFormReducer(one, { type: 'toggleDate', iso: '2026-10-16' });
    expect([...two.dates]).toEqual(['2026-10-15', '2026-10-16']);
    const back = createFormReducer(two, { type: 'toggleDate', iso: '2026-10-15' });
    expect([...back.dates]).toEqual(['2026-10-16']);
  });

  it('sets a text field and the suggestions flag', () => {
    const s1 = createFormReducer(initialCreateForm, { type: 'field', key: 'title', value: 'Dinner' });
    const s2 = createFormReducer(s1, { type: 'allowSuggestions', value: false });
    expect(s2.title).toBe('Dinner');
    expect(s2.description).toBe('');
    expect(s2.allowSuggestions).toBe(false);
  });

  it('moves progress forward with a clean slate at each step', () => {
    expect(withProgress(initialCreateForm, 2).progress).toEqual({ step: 2, failed: false, message: null });
  });

  it('marks the current step failed with the message, and step 0 when nothing had started', () => {
    const failedAtTwo = createFormReducer(withProgress(initialCreateForm, 2), {
      type: 'progressFailed',
      message: 'Network error.',
    });
    expect(failedAtTwo.progress).toEqual({ step: 2, failed: true, message: 'Network error.' });
    const failedCold = createFormReducer(initialCreateForm, { type: 'progressFailed', message: 'x' });
    expect(failedCold.progress).toEqual({ step: 0, failed: true, message: 'x' });
  });

  it('clears progress', () => {
    const cleared = createFormReducer(withProgress(initialCreateForm, 1), { type: 'progressCleared' });
    expect(cleared.progress).toBeNull();
  });

  it('replaces the error map wholesale and stores the Turnstile token', () => {
    const s1 = createFormReducer(initialCreateForm, { type: 'errors', errors: { title: 'Title is required' } });
    const s2 = createFormReducer(s1, { type: 'errors', errors: { form: 'Please verify.' } });
    expect(s2.fieldErrors).toEqual({ form: 'Please verify.' });
    expect(createFormReducer(s2, { type: 'turnstile', token: 'tok' }).turnstileToken).toBe('tok');
  });
});

describe('firstInvalidField', () => {
  it('follows the visual order of the fields, not the order of the errors', () => {
    expect(firstInvalidField({ dates: 'x', title: 'y' })).toBe('title');
    expect(firstInvalidField({ dates: 'x' })).toBe('dates');
  });

  it('ignores errors that have no field to focus', () => {
    expect(firstInvalidField({ form: 'x' })).toBeNull();
    expect(firstInvalidField({})).toBeNull();
  });
});
