import { ApiRequestError } from './api';

const MESSAGES: Record<string, string> = {
  captcha_failed: 'The verification check failed. Please try again.',
  rate_limited: 'Too many requests from your connection. Wait a minute and try again.',
  ticket_too_early: 'That was quick. Please wait a moment and try again.',
  ticket_expired: 'The creation step timed out. Please try again.',
  ticket_used: 'This creation attempt was already used. Please try again.',
  ticket_invalid: 'The creation step could not be verified. Please try again.',
  validation_failed: 'Some of the details were not accepted. Please check the form.',
  nickname_taken: 'Someone in this poll already uses that nickname.',
  event_full: 'This poll has reached its participant limit.',
  too_many_options: 'This poll already has the maximum number of dates.',
  date_exists: 'That date is already in the poll.',
  unknown_option: 'The poll changed while you were answering. Please reload and try again.',
  suggestions_disabled: 'The organiser has turned off date suggestions.',
  not_owner: 'You can only change your own answers.',
  admin_required: 'This action needs the admin link.',
  expired: 'This poll has expired and was deleted.',
  not_found: 'This poll does not exist or was deleted.',
  internal: 'Something went wrong on our side. Please try again.',
};

export function describeError(err: unknown): string {
  if (err instanceof ApiRequestError) return MESSAGES[err.code] ?? err.message;
  if (err instanceof TypeError) return 'Network error. Check your connection and try again.';
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
