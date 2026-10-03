import type { EventOption } from '@shared/types';
import { formatDate, formatDateLong } from '../lib/dates';

interface Props {
  option: EventOption;
  /** This date has the most yes answers; the column is highlighted. */
  isBest: boolean;
  /** Only the organiser can remove a date. */
  canRemove: boolean;
  disabled: boolean;
  onRemove: (option: EventOption) => void;
}

/** The column header for one date: weekday, day, year, a tag for suggested dates and the remove button. */
export function OptionHeader({ option, isBest, canRemove, disabled, onRemove }: Props) {
  return (
    <th scope="col" className={`option-col${isBest ? ' is-best' : ''}`}>
      <span className="opt-weekday">{formatDate(option.date, { weekday: 'short' })}</span>
      <span className="opt-day">{formatDate(option.date, { day: 'numeric', month: 'short' })}</span>
      <span className="opt-year">{option.date.slice(0, 4)}</span>
      {option.suggestedBy && (
        <span className="opt-tag" title="Suggested by a participant">
          suggested
        </span>
      )}
      {canRemove && (
        <button
          type="button"
          className="icon-btn danger"
          onClick={() => onRemove(option)}
          disabled={disabled}
          aria-label={`Remove ${formatDateLong(option.date)}`}
          title="Remove this date"
        >
          ×
        </button>
      )}
    </th>
  );
}
