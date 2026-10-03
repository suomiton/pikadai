import type { Ref } from 'react';
import { LIMITS } from '@shared/limits';
import type { Answer, EventOption } from '@shared/types';
import { VoteCells } from './VoteCells';

interface Props {
  options: readonly EventOption[];
  isBest: (optionId: string) => boolean;
  votes: Record<string, Answer>;
  onToggle: (option: EventOption) => void;
  nickname: string;
  onNicknameChange: (value: string) => void;
  /** The nickname is missing; the input points at the panel's error message. */
  nicknameInvalid: boolean;
  errorId: string;
  nicknameRef: Ref<HTMLInputElement>;
  isMine: boolean;
  /** A new answer: move focus into the nickname input so the keyboard user lands where typing starts. */
  focusOnMount?: boolean;
  placeholder?: string;
}

/** The row being edited, for a new answer or an existing one: nickname input and vote buttons. */
export function VoteEditRow({
  options,
  isBest,
  votes,
  onToggle,
  nickname,
  onNicknameChange,
  nicknameInvalid,
  errorId,
  nicknameRef,
  isMine,
  focusOnMount,
  placeholder,
}: Props) {
  return (
    <tr className={isMine ? 'is-me is-editing' : 'is-editing'}>
      <th scope="row" className="name-col">
        <input
          ref={nicknameRef}
          className="input input-sm"
          value={nickname}
          onChange={(e) => onNicknameChange(e.target.value)}
          maxLength={LIMITS.nicknameMax}
          aria-label="Nickname"
          aria-invalid={nicknameInvalid || undefined}
          aria-describedby={nicknameInvalid ? errorId : undefined}
          // Deliberate (review finding A13): the row appears on a button press and typing is the next step.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={focusOnMount}
          placeholder={placeholder}
        />
      </th>
      <VoteCells options={options} votes={votes} isBest={isBest} onToggle={onToggle} />
      <td className="actions-col" />
    </tr>
  );
}
