import type { RefObject } from 'react';
import type { VoteRemoval } from '../hooks/useVoteRemoval';
import { formatDateLong } from '../lib/dates';
import { usePoll } from '../state/AppStateProvider';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  removal: VoteRemoval;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}

const removalCopy = (removal: VoteRemoval, participantId?: string) => {
  if (removal.kind === 'option')
    return {
      title: 'Remove this date?',
      description: `${formatDateLong(removal.option.date)} and every answer for it will be removed. This cannot be undone.`,
    };
  if (participantId === removal.participant.id)
    return {
      title: 'Remove your answers?',
      description: 'Your answers and comments will be removed from this poll. This cannot be undone.',
    };
  return {
    title: `Remove ${removal.participant.name}?`,
    description: `${removal.participant.name} and all their answers and comments will be removed from this poll. This cannot be undone.`,
  };
};

export function VoteRemovalDialog({ removal, ...props }: Props) {
  const { me } = usePoll();
  return (
    <ConfirmDialog
      {...removalCopy(removal, me?.id)}
      confirmLabel={removal.kind === 'option' ? 'Remove date' : 'Remove answers'}
      busyLabel={removal.kind === 'option' ? 'Removing date…' : 'Removing answers…'}
      {...props}
    />
  );
}
