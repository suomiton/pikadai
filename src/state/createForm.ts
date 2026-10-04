/**
 * State of the create-poll form: the draft, the Turnstile token, validation errors and the
 * progress dialog. Pure, so the transitions are unit-tested; useCreateForm owns the effects.
 */
export type FieldKey = 'title' | 'description' | 'dates';

/** Fields that can carry a validation error, in the order focus should visit them. */
export const FIELD_ORDER: readonly FieldKey[] = ['title', 'description', 'dates'];

export interface Progress {
  step: number;
  failed: boolean;
  message: string | null;
}

export interface CreateFormState {
  title: string;
  description: string;
  dates: ReadonlySet<string>;
  allowSuggestions: boolean;
  turnstileToken: string | null;
  /** Keyed by field, plus `form` for errors that belong to no field. */
  fieldErrors: Record<string, string>;
  progress: Progress | null;
}

export type CreateFormAction =
  | { type: 'field'; key: 'title' | 'description'; value: string }
  | { type: 'allowSuggestions'; value: boolean }
  | { type: 'toggleDate'; iso: string }
  | { type: 'turnstile'; token: string | null }
  | { type: 'errors'; errors: Record<string, string> }
  | { type: 'progress'; step: number }
  | { type: 'progressFailed'; message: string }
  | { type: 'progressCleared' };

export const initialCreateForm: CreateFormState = {
  title: '',
  description: '',
  dates: new Set(),
  allowSuggestions: true,
  turnstileToken: null,
  fieldErrors: {},
  progress: null,
};

export function createFormReducer(state: CreateFormState, action: CreateFormAction): CreateFormState {
  switch (action.type) {
    case 'field':
      return { ...state, [action.key]: action.value };
    case 'allowSuggestions':
      return { ...state, allowSuggestions: action.value };
    case 'toggleDate': {
      const dates = new Set(state.dates);
      if (dates.has(action.iso)) dates.delete(action.iso);
      else dates.add(action.iso);
      return { ...state, dates };
    }
    case 'turnstile':
      return { ...state, turnstileToken: action.token };
    case 'errors':
      return { ...state, fieldErrors: action.errors };
    case 'progress':
      return { ...state, progress: { step: action.step, failed: false, message: null } };
    case 'progressFailed':
      return { ...state, progress: { step: state.progress?.step ?? 0, failed: true, message: action.message } };
    case 'progressCleared':
      return { ...state, progress: null };
  }
}

/** The field focus should land on after a failed submit, or null when only form-level errors exist. */
export function firstInvalidField(errors: Record<string, string>): FieldKey | null {
  return FIELD_ORDER.find((key) => key in errors) ?? null;
}
