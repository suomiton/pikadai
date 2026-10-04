import { useId } from 'react';
import { LIMITS } from '@shared/limits';
import { useComments } from '../hooks/useComments';
import { formatDateTime } from '../lib/dates';
import { FormError } from './FormError';
import { StatusAnnouncer } from './StatusAnnouncer';
import { TextField } from './TextField';

/**
 * The comments under the availability table. Anyone can read them; posting needs the identity the
 * join step created, and the form is shown once per page load: after a comment goes out it stays
 * hidden until the page is reloaded. Comments cannot be edited or deleted here; they leave with
 * their participant.
 */
export function Comments() {
  const id = useId();
  const {
    event,
    me,
    body,
    setBody,
    bodyError,
    setBodyError,
    posted,
    status,
    busy,
    error,
    textareaRef,
    postedNoteRef,
    canComment,
    submit,
  } = useComments();
  return (
    <section className="card stack" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Comments</h2>
      <StatusAnnouncer message={status} />

      {event.comments.length === 0 ? (
        <p className="hint">No comments yet.</p>
      ) : (
        <ol className="comment-list">
          {event.comments.map((c) => (
            <li key={c.id} className={me?.id === c.participantId ? 'comment is-me' : 'comment'}>
              <p className="comment-head">
                <span className="comment-author">{c.name}</span>
                {me?.id === c.participantId && <span className="tag">you</span>}
                {c.isOrganiser && <span className="tag tag-accent">organiser</span>}
                <time className="comment-time" dateTime={new Date(c.createdAt).toISOString()}>
                  {formatDateTime(c.createdAt)}
                </time>
              </p>
              <p className="comment-body">{c.body}</p>
            </li>
          ))}
        </ol>
      )}

      {canComment && (
        <form className="comment-form stack" onSubmit={submit} noValidate>
          <TextField
            id={`${id}-body`}
            ref={textareaRef}
            label="Add a comment"
            value={body}
            onChange={(value) => {
              setBody(value);
              setBodyError(undefined);
            }}
            error={bodyError}
            hint={
              <span className="field-counter">
                {body.length} / {LIMITS.commentMax}
              </span>
            }
            multiline
            rows={3}
            maxLength={LIMITS.commentMax}
            required
          />
          <FormError message={error} />
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Sending' : 'Send'}
            </button>
          </div>
        </form>
      )}

      {posted && (
        <p ref={postedNoteRef} tabIndex={-1} className="hint">
          Your comment was posted. Reload the page to write another.
        </p>
      )}
      {me === null && !posted && <p className="hint">Join the poll with your name above to comment.</p>}
    </section>
  );
}
