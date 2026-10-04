import { useState } from 'react';
import type { EventOption, Participant } from '@shared/types';
import { api } from '../lib/api';
import { formatDateLong } from '../lib/dates';
import { usePoll, usePollActions } from '../state/AppStateProvider';
import type { AsyncAction } from './useAsyncAction';
import type { VoteEditor } from './useVoteEditor';

export type VoteRemoval = { kind: 'participant'; participant: Participant } | { kind: 'option'; option: EventOption };

/** Keeps a failed removal open for retry and leaves an unconfirmed editing draft intact. */
export function useVoteRemoval(
  editor: VoteEditor,
  { busy, run, setError }: AsyncAction,
  setStatus: (value: string) => void,
) {
  const { event, me, adminToken } = usePoll();
  const { refresh, setIdentity } = usePollActions();
  const [pendingRemoval, setPendingRemoval] = useState<VoteRemoval | null>(null);

  const removeParticipant = async (participant: Participant) => {
    const mine = me?.id === participant.id;
    const removed = await run(async () => {
      await api.deleteParticipant(event.id, participant.id, { adminToken, participant: mine ? me : null });
      if (mine) setIdentity(event.id, null);
      editor.close();
      await refresh(event.id);
    });
    if (removed) {
      setStatus(mine ? 'Your answers were removed.' : `${participant.name} was removed from the poll.`);
      setPendingRemoval(null);
    }
  };

  const removeOption = async (option: EventOption) => {
    if (!adminToken) return;
    const removed = await run(async () => {
      await api.deleteOption(event.id, option.id, adminToken);
      await refresh(event.id);
    });
    if (removed) {
      setStatus(`${formatDateLong(option.date)} was removed from the poll.`);
      setPendingRemoval(null);
    }
  };

  const requestRemoval = (removal: VoteRemoval) => {
    if (busy) return;
    setError(null);
    setPendingRemoval(removal);
  };

  const confirmRemoval = () => {
    if (!pendingRemoval || busy) return;
    if (pendingRemoval.kind === 'participant') void removeParticipant(pendingRemoval.participant);
    else void removeOption(pendingRemoval.option);
  };

  const cancelRemoval = () => {
    setPendingRemoval(null);
    setError(null);
  };

  return { pendingRemoval, requestRemoval, confirmRemoval, cancelRemoval };
}
