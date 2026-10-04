import { useCallback, useEffect, useRef, useState } from 'react';

type FocusTarget = 'return' | 'editor';

interface FocusControls {
  section: HTMLElement | null;
  nameInput: HTMLInputElement | null;
  tableRegion: HTMLDivElement | null;
}

const focusEditorTarget = (
  { section, nameInput, tableRegion }: FocusControls,
  target: FocusTarget,
  returnTo: string | null,
  participantId?: string,
) => {
  if (!section) return;
  const editButton = (id: string) => section.querySelector<HTMLElement>(`[data-edit-for="${id}"]`);
  const candidates =
    target === 'editor'
      ? [section.querySelector<HTMLElement>('tr.is-editing .vote-btn'), nameInput]
      : [returnTo ? editButton(returnTo) : null, participantId ? editButton(participantId) : null, tableRegion];
  candidates.find((el): el is HTMLElement => el !== null)?.focus();
};

/** Focus the newly opened row or its opener once disabled controls become available. */
export function useVoteEditorFocus(returnTo: string | null, participantId: string | undefined, busy: boolean) {
  const sectionRef = useRef<HTMLElement>(null);
  const tableRegionRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [focusRequest, setFocusRequest] = useState({ seq: 0, target: 'return' as FocusTarget });
  const handledFocusRequest = useRef(0);

  useEffect(() => {
    if (focusRequest.seq === handledFocusRequest.current || busy) return;
    handledFocusRequest.current = focusRequest.seq;
    focusEditorTarget(
      { section: sectionRef.current, nameInput: nameRef.current, tableRegion: tableRegionRef.current },
      focusRequest.target,
      returnTo,
      participantId,
    );
  }, [focusRequest, busy, returnTo, participantId]);

  const requestFocus = useCallback((target: FocusTarget) => setFocusRequest((r) => ({ seq: r.seq + 1, target })), []);
  return { sectionRef, tableRegionRef, nameRef, requestFocus };
}

export type VoteEditorFocus = ReturnType<typeof useVoteEditorFocus>;
