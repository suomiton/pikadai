import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createCommentSchema } from '@shared/schemas';
import { api } from '../lib/api';
import { usePoll, usePollActions } from '../state/AppStateProvider';
import { useAsyncAction } from './useAsyncAction';

// Fit the textarea to its text, and repeat when wrapping changes with its width.
const observeTextareaSize = (el: HTMLTextAreaElement) => {
  const fit = () => {
    el.style.height = 'auto';
    // scrollHeight excludes the border; the field uses border-box sizing.
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
  };
  fit();
  let width = el.clientWidth;
  const observer = new ResizeObserver(() => {
    if (el.clientWidth === width) return;
    width = el.clientWidth;
    fit();
  });
  observer.observe(el);
  return () => observer.disconnect();
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

  const canComment = me !== null && !posted;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el) return observeTextareaSize(el);
  }, [body, canComment]);

  // The form unmounts once the comment is posted; focus moves to the note that took its place.
  useEffect(() => {
    if (posted && !busy) postedNoteRef.current?.focus();
  }, [posted, busy]);

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
      await api.addComment(event.id, parsed.data, me);
      setPosted(true);
      await refresh(event.id);
    });
    if (sent) setStatus('Your comment was posted.');
  };

  return {
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
  };
}
