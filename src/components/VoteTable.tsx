import type { ComponentProps, Ref } from 'react';
import type { EventOption, Participant } from '@shared/types';
import type { Tallies } from '../lib/votes';
import { usePoll } from '../state/AppStateProvider';
import { OptionHeader } from './OptionHeader';
import { VoteEditRow } from './VoteEditRow';
import { VoteRow } from './VoteRow';

interface Props {
  editingId: string | null;
  showAll: boolean;
  rows: readonly Participant[];
  editRowProps: Omit<ComponentProps<typeof VoteEditRow>, 'isMine' | 'participant'>;
  busy: boolean;
  isBest: (optionId: string) => boolean;
  tallies: Tallies;
  onEdit: (participant: Participant) => void;
  onRemoveOption: (option: EventOption) => void;
  ref: Ref<HTMLDivElement>;
}

const VoteTableHead = ({
  showAll,
  busy,
  isBest,
  onRemoveOption,
}: Pick<Props, 'showAll' | 'busy' | 'isBest' | 'onRemoveOption'>) => {
  const { event, isAdmin } = usePoll();
  return (
    <thead>
      <tr>
        <th scope="col" className="name-col">
          {showAll ? `${event.participants.length} ${event.participants.length === 1 ? 'answer' : 'answers'}` : 'You'}
        </th>
        {event.options.map((option) => (
          <OptionHeader
            key={option.id}
            option={option}
            isBest={isBest(option.id)}
            canRemove={isAdmin}
            disabled={busy}
            onRemove={onRemoveOption}
          />
        ))}
        <th scope="col" className="actions-col">
          <span className="visually-hidden">Actions</span>
        </th>
      </tr>
    </thead>
  );
};

const VoteTableBody = ({
  showAll,
  rows,
  editingId,
  editRowProps,
  busy,
  isBest,
  onEdit,
}: Pick<Props, 'showAll' | 'rows' | 'editingId' | 'editRowProps' | 'busy' | 'isBest' | 'onEdit'>) => {
  const { event, me, isAdmin } = usePoll();
  return (
    <tbody>
      {rows.map((participant) =>
        editingId === participant.id ? (
          <VoteEditRow
            key={participant.id}
            participant={participant}
            {...editRowProps}
            isMine={me?.id === participant.id}
          />
        ) : (
          <VoteRow
            key={participant.id}
            participant={participant}
            options={event.options}
            isBest={isBest}
            isMine={me?.id === participant.id}
            canEdit={(isAdmin || me?.id === participant.id) && editingId === null}
            disabled={busy}
            onEdit={onEdit}
          />
        ),
      )}
      {showAll && event.participants.length === 0 && (
        <tr className="is-empty">
          <td colSpan={event.options.length + 2}>No answers yet. Be the first.</td>
        </tr>
      )}
    </tbody>
  );
};

const VoteTableFoot = ({ tallies, isBest }: Pick<Props, 'tallies' | 'isBest'>) => {
  const { event } = usePoll();
  return (
    <tfoot>
      <tr>
        <th scope="row" className="name-col">
          yes <span className="muted">/ if need be</span>
        </th>
        {event.options.map((option) => (
          <td key={option.id} className={`tally${isBest(option.id) ? ' is-best' : ''}`}>
            <strong>{tallies[option.id]?.yes ?? 0}</strong>
            <span className="muted"> / {tallies[option.id]?.maybe ?? 0}</span>
          </td>
        ))}
        <td className="actions-col" />
      </tr>
    </tfoot>
  );
};

/** Table markup stays independent of requests, confirmation dialogs and focus restoration. */
export function VoteTable({ ref, ...props }: Props) {
  return (
    <div
      ref={ref}
      className="table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Availability table, scrolls sideways"
    >
      <table className="vote-table">
        <caption className="visually-hidden">
          {props.showAll
            ? 'One row per participant and one column per date. The last row counts the yes and if-need-be answers for each date.'
            : 'Your row, with one column per date.'}
        </caption>
        <VoteTableHead {...props} />
        <VoteTableBody {...props} />
        {props.showAll && <VoteTableFoot {...props} />}
      </table>
    </div>
  );
}
