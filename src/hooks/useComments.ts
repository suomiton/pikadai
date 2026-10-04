import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createCommentSchema } from '@shared/schemas';
import { api } from '../lib/api';
import { isParticipantDisabled } from '../lib/errors';
import { usePoll, usePollActions } from '../state/AppStateProvider';
import { useAsyncAction } from './useAsyncAction';

const fitTextarea = (el: HTMLTextAreaElement) => {
  el.style.height = 'auto';
  // scrollHeight excludes the border; the field uses border-box sizing.
  const border = el.offsetHeight - el.clientHeight;
  el.style.height = `${el.scrollHeight + border}px`;
};

// Schedule width-driven resizing outside the observer's delivery cycle.
const observeTextareaSize = (el: HTMLTextAreaElement) => {
  let width = el.clientWidth;
  let frame: number | undefined;
  const observer = new ResizeObserver(() => {
    if (el.clientWidth === width) return;
    width = el.clientWidth;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      fitTextarea(el);
    });
  });
  observer.observe(el);
  return () => {
    observer.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
};

/** Owns comment submission, textarea sizing and focus after posting. */
export function useComments() {
  const { event, me } = usePoll();
  const { refresh } = usePollActions();
  const [body, setBody] = useState('');
  const [bodyError, setBodyError] = useState<string | undefined>();
  const [posted, setPosted] = useState(false);
  const [status, setStatus] = useState('');
  const { busy, error, run } = useAsyncAction();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const postedNoteRef = useRef<HTMLParagraphElement>(null);

  // The server refuses a disabled participant's comments; the form is not offered to them.
  const isDisabled = me !== null && event.participants.some((p) => p.id === me.id && p.isDisabled);
  const canComment = me !== null && !isDisabled && !posted;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el) return observeTextareaSize(el);
  }, [canComment]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el) fitTextarea(el);
  }, [body, canComment]);

  // The form unmounts once the comment is posted; focus moves to the note that took its place.
  useEffect(() => {
    if (posted && !busy) postedNoteRef.current?.focus();
  }, [posted, busy]);

  const onBodyChange = (value: string) => {
    setBody(value);
    setBodyError(undefined);
  };

  const submit = async (e: FormEvent) => {
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
      try {
        await api.addComment(event.id, parsed.data, me);
      } catch (err) {
        if (isParticipantDisabled(err)) void refresh(event.id);
        throw err;
      }
      setPosted(true);
      await refresh(event.id);
    });
    if (sent) setStatus('Your comment was posted.');
  };

  return {
    event,
    me,
    body,
    onBodyChange,
    bodyError,
    posted,
    status,
    busy,
    error,
    textareaRef,
    postedNoteRef,
    isDisabled,
    canComment,
    submit,
  };
}
