import type { EventView } from '@shared/types';

/**
 * State of the organiser's details form. Pure, so the transitions are unit-tested; useAdminForm
 * owns the request, the focus moves and the live region.
 */
export type AdminFieldKey = 'title' | 'description';

type EventFields = Pick<EventView, 'title' | 'description' | 'allowSuggestions'>;

export interface AdminFormState {
  open: boolean;
  title: string;
  description: string;
  allowSuggestions: boolean;
  fieldErrors: Partial<Record<AdminFieldKey, string>>;
}

export type AdminFormAction =
  | { type: 'open' }
  | { type: 'close' }
  /** Copy the saved values in; ignored while the form is open so a draft is never overwritten. */
  | { type: 'sync'; event: EventFields }
  | { type: 'field'; key: AdminFieldKey; value: string }
  | { type: 'allowSuggestions'; value: boolean }
  | { type: 'errors'; errors: Partial<Record<AdminFieldKey, string>> };

export function adminFormFromEvent(event: EventFields): AdminFormState {
  return {
    open: false,
    title: event.title,
    description: event.description,
    allowSuggestions: event.allowSuggestions,
    fieldErrors: {},
  };
}

export function adminFormReducer(state: AdminFormState, action: AdminFormAction): AdminFormState {
  switch (action.type) {
    case 'open':
      return { ...state, open: true };
    case 'close':
      return { ...state, open: false, fieldErrors: {} };
    case 'sync':
      if (state.open) return state;
      return {
        ...state,
        title: action.event.title,
        description: action.event.description,
        allowSuggestions: action.event.allowSuggestions,
      };
    case 'field':
      return { ...state, [action.key]: action.value };
    case 'allowSuggestions':
      return { ...state, allowSuggestions: action.value };
    case 'errors':
      return { ...state, fieldErrors: action.errors };
  }
}
