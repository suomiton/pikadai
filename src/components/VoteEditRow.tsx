import type { Ref } from 'react';
import { LIMITS } from '@shared/limits';
import type { Answer, EventOption, Participant } from '@shared/types';
import { VoteCells } from './VoteCells';

interface Props {
  participant: Participant;
  options: readonly EventOption[];
  isBest: (optionId: string) => boolean;
  votes: Record<string, Answer>;
  onToggle: (option: EventOption) => void;
  /**
   * The organiser renames other people from their row. One's own name is changed in the Name tile,
   * so the viewer's own row shows it as text.
   */
  nameEditable: boolean;
  name: string;
  onNameChange: (value: string) => void;
  /** The name is missing; the input points at the panel's error message. */
  nameInvalid: boolean;
  errorId: string;
  nameRef: Ref<HTMLInputElement>;
  isMine: boolean;
}

/** A participant's row while it is being edited: the name, as an input or text, and the vote buttons. */
export function VoteEditRow({
  participant: p,
  options,
  isBest,
  votes,
  onToggle,
  nameEditable,
  name,
  onNameChange,
  nameInvalid,
  errorId,
  nameRef,
  isMine,
}: Props) {
  return (
    <tr className={isMine ? 'is-me is-editing' : 'is-editing'}>
      <th scope="row" className="name-col">
        {nameEditable ? (
          <input
            ref={nameRef}
            className="input input-sm"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            maxLength={LIMITS.nameMax}
            aria-label="Name"
            aria-invalid={nameInvalid || undefined}
            aria-describedby={nameInvalid ? errorId : undefined}
          />
        ) : (
          <>
            <span className="participant-name">{p.name}</span>
            {isMine && <span className="tag">you</span>}
            {p.isOrganiser && <span className="tag tag-accent">organiser</span>}
          </>
        )}
      </th>
      <VoteCells options={options} votes={votes} isBest={isBest} onToggle={onToggle} />
      <td className="actions-col" />
    </tr>
  );
}
