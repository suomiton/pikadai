import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { LIMITS } from '@shared/limits';
import { createCommentSchema } from '@shared/schemas';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/dates';
import { usePoll, usePollActions } from '../state/AppStateProvider';
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
  const { event, me } = usePoll();
  const { refresh } = usePollActions();
  const id = useId();
  const [body, setBody] = useState('');
  const [bodyError, setBodyError] = useState<string | undefined>();
  const [posted, setPosted] = useState(false);
  const [status, setStatus] = useState('');
  const { busy, error, run } = useAsyncAction();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const postedNoteRef = useRef<HTMLParagraphElement>(null);

  const canComment = me !== null && !posted;

  // The textarea grows with the text so the whole comment stays in view; it never scrolls inside.
  // Lines wrap differently when the field gets narrower or wider (a window resized, a phone turned),
  // so the measurement also reruns when its width changes.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const fit = () => {
      el.style.height = 'auto';
      // scrollHeight leaves the border out, and the box is sized border-box.
      const border = el.offsetHeight - el.clientHeight;
      el.style.height = `${el.scrollHeight + border}px`;
    };
    fit();
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      // Only a width change matters; the height changes are our own.
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [body, canComment]);

  // The form unmounts once the comment is posted; focus moves to the note that took its place.
  useEffect(() => {
    if (posted && !busy) postedNoteRef.current?.focus();
  }, [posted, busy]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!me || busy) return;
    const parsed = createCommentSchema.safeParse({ body });
    if (!parsed.success) {
      setBodyError(parsed.error.issues[0].message);
      textareaRef.current?.focus();
      return;
    }
    setBodyError(undefined);
    const sent = await run(async () => {
      await api.addComment(event.id, parsed.data, me);
      setPosted(true);
      await refresh(event.id);
    });
    if (sent) setStatus('Your comment was posted.');
  }

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
