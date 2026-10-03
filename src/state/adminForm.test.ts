import { describe, expect, it } from 'vitest';
import { adminFormFromEvent, adminFormReducer } from './adminForm';

const event = { title: 'Dinner', description: 'Somewhere central', allowSuggestions: true };

describe('adminFormFromEvent', () => {
  it('starts closed, with the event copied into the fields and no errors', () => {
    expect(adminFormFromEvent(event)).toEqual({
      open: false,
      title: 'Dinner',
      description: 'Somewhere central',
      allowSuggestions: true,
      fieldErrors: {},
    });
  });
});

describe('adminFormReducer', () => {
  const closed = adminFormFromEvent(event);
  const opened = adminFormReducer(closed, { type: 'open' });

  it('syncs the fields from a fresh event while the form is closed', () => {
    const synced = adminFormReducer(closed, { type: 'sync', event: { ...event, title: 'Lunch' } });
    expect(synced.title).toBe('Lunch');
  });

  it('leaves an open form alone when the event changes underneath it', () => {
    const edited = adminFormReducer(opened, { type: 'field', key: 'title', value: 'My draft' });
    const synced = adminFormReducer(edited, { type: 'sync', event: { ...event, title: 'Lunch' } });
    expect(synced).toBe(edited);
  });

  it('updates one field or the suggestions flag at a time', () => {
    const s1 = adminFormReducer(opened, { type: 'field', key: 'description', value: 'Bring wine' });
    const s2 = adminFormReducer(s1, { type: 'allowSuggestions', value: false });
    expect(s2).toMatchObject({ title: 'Dinner', description: 'Bring wine', allowSuggestions: false });
  });

  it('stores validation errors and clears them on close', () => {
    const withErrors = adminFormReducer(opened, { type: 'errors', errors: { title: 'Title is required' } });
    expect(withErrors.fieldErrors).toEqual({ title: 'Title is required' });
    const closedAgain = adminFormReducer(withErrors, { type: 'close' });
    expect(closedAgain.open).toBe(false);
    expect(closedAgain.fieldErrors).toEqual({});
  });
});
