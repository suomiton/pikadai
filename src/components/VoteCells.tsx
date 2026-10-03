import type { Answer, EventOption } from '@shared/types';
import { formatDateLong } from '../lib/dates';
import { GLYPH, LABEL, type Cell } from '../lib/votes';

interface Props {
  options: readonly EventOption[];
  votes: Record<string, Answer>;
  isBest: (optionId: string) => boolean;
  /** When given, each cell is a button that cycles the answer; otherwise cells are read-only glyphs. */
  onToggle?: (option: EventOption) => void;
}

/** One `<td>` per date for a participant row, saved or being edited. */
export function VoteCells({ options, votes, isBest, onToggle }: Props) {
  return options.map((o) => {
    const cell: Cell = votes[o.id] ?? 'none';
    const className = `vote-cell is-${cell}${isBest(o.id) ? ' is-best' : ''}`;
    return (
      <td key={o.id} className={className}>
        {onToggle ? (
          <button
            type="button"
            className="vote-btn"
            onClick={() => onToggle(o)}
            aria-label={`${formatDateLong(o.date)}: ${LABEL[cell]}`}
            title={LABEL[cell]}
          >
            {GLYPH[cell]}
          </button>
        ) : (
          <span className="vote-glyph" role="img" aria-label={LABEL[cell]} title={LABEL[cell]}>
            {GLYPH[cell]}
          </span>
        )}
      </td>
    );
  });
}
