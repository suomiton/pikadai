import { useEffect, useMemo, useReducer, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { eventDraftSchema, type EventDraft } from '@shared/schemas';
import { api } from '../lib/api';
import { describeError } from '../lib/errors';
import { sleep, waitUntil } from '../lib/timing';
import { fieldErrorsFromIssues } from '../lib/validation';
import { createFormReducer, firstInvalidField, initialCreateForm, type FieldKey } from '../state/createForm';

// Pace steps against the ticket's required wait, with headroom for clock drift.
const STEP_STARTS = [0.28, 0.62] as const;
const TICKET_HEADROOM_MS = 800;

const createWithProgress = async (draft: EventDraft, turnstileToken: string, onStep: (step: number) => void) => {
  const startedAt = Date.now();
  onStep(0);
  const { ticket, minAgeMs } = await api.createTicket();
  // Count from receipt so the Worker sees an old-enough ticket regardless of clock differences.
  const sendAt = Date.now() + minAgeMs + TICKET_HEADROOM_MS;
  const total = sendAt - startedAt;
  for (const [index, share] of STEP_STARTS.entries()) {
    await waitUntil(startedAt + total * share);
    onStep(index + 1);
  }
  await waitUntil(sendAt);
  const created = await api.createEvent({ ...draft, ticket, turnstileToken });
  onStep(3);
  await sleep(700);
  return created;
};

/** Owns validation, submission progress and focus for the create-poll form. */
export function useCreateForm() {
  const navigate = useNavigate();
  const [form, dispatch] = useReducer(createFormReducer, initialCreateForm);
  const dates = useMemo(() => [...form.dates].sort(), [form.dates]);
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const datesRef = useRef<HTMLDivElement>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);
  const focusAfterErrors = useRef<FieldKey | null>(null);

  // Wait until the error is in the DOM so it is read together with the focused field.
  useEffect(() => {
    const key = focusAfterErrors.current;
    if (!key) return;
    focusAfterErrors.current = null;
    (key === 'title' ? titleRef : key === 'description' ? descriptionRef : datesRef).current?.focus();
  }, [form.fieldErrors]);

  const validate = () => {
    const parsed = eventDraftSchema.safeParse({
      title: form.title,
      description: form.description,
      dates,
      allowSuggestions: form.allowSuggestions,
    });
    if (!parsed.success) {
      const errors = fieldErrorsFromIssues(parsed.error.issues);
      focusAfterErrors.current = firstInvalidField(errors);
      dispatch({ type: 'errors', errors });
      return null;
    }
    if (!form.turnstileToken) {
      dispatch({ type: 'errors', errors: { form: 'Please complete the verification first.' } });
      return null;
    }
    dispatch({ type: 'errors', errors: {} });
    return { draft: parsed.data, turnstileToken: form.turnstileToken };
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const input = validate();
    if (!input) return;
    try {
      const created = await createWithProgress(input.draft, input.turnstileToken, (step) =>
        dispatch({ type: 'progress', step }),
      );
      // EventPage captures the fragment even when browser storage is blocked.
      navigate(`/e/${created.id}#admin=${created.adminToken}`);
    } catch (err) {
      dispatch({ type: 'progressFailed', message: describeError(err) });
      turnstileRef.current?.reset();
      dispatch({ type: 'turnstile', token: null });
    }
  };

  return {
    form,
    dates,
    dispatch,
    handleSubmit,
    toggleDate: (iso: string) => dispatch({ type: 'toggleDate', iso }),
    refs: { titleRef, descriptionRef, datesRef, turnstileRef },
  };
}

export type CreateFormController = ReturnType<typeof useCreateForm>;
