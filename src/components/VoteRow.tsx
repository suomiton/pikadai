import type { EventOption, Participant } from '@shared/types';
import { VoteCells } from './VoteCells';

interface Props {
  participant: Participant;
  options: readonly EventOption[];
  isBest: (optionId: string) => boolean;
  /** This browser's own answer; shows the "you" tag. */
  isMine: boolean;
  /** The viewer may edit this row (their own, or any row for the organiser) and no editor is open. */
  canEdit: boolean;
  disabled: boolean;
  onEdit: (participant: Participant) => void;
}

/** A saved participant: nickname with its tags, read-only answer glyphs and the Edit button. */
export function VoteRow({ participant: p, options, isBest, isMine, canEdit, disabled, onEdit }: Props) {
  return (
    <tr className={isMine ? 'is-me' : undefined}>
      <th scope="row" className="name-col">
        <span className="participant-name">{p.nickname}</span>
        {isMine && <span className="tag">you</span>}
        {p.isOrganiser && <span className="tag tag-accent">organiser</span>}
      </th>
      <VoteCells options={options} votes={p.votes} isBest={isBest} />
      <td className="actions-col">
        {canEdit && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            data-edit-for={p.id}
            onClick={() => onEdit(p)}
            disabled={disabled}
            aria-label={isMine ? 'Edit your answers' : `Edit ${p.nickname}`}
          >
            Edit
          </button>
        )}
      </td>
    </tr>
  );
}
