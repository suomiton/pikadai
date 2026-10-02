import { useMemo, useState } from 'react';
import { WEEKDAYS, formatMonth, monthGrid, shiftMonth, todayIso, type MonthCursor } from '../lib/dates';

interface Props {
  selected: ReadonlySet<string>;
  onToggle: (iso: string) => void;
  /** Dates before this (ISO) cannot be picked. */
  minDate?: string;
  /** Dates that already exist elsewhere and cannot be picked again. */
  disabledDates?: ReadonlySet<string>;
}

export function Calendar({ selected, onToggle, minDate, disabledDates }: Props) {
  const today = todayIso();
  const [cursor, setCursor] = useState<MonthCursor>(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const weeks = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);

  return (
    <div className="calendar">
      <div className="calendar-head">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setCursor((c) => shiftMonth(c, -1))}
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="calendar-title">{formatMonth(cursor)}</span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setCursor((c) => shiftMonth(c, 1))}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="calendar-grid">
        {WEEKDAYS.map((d) => (
          <span key={d} className="calendar-weekday" aria-hidden="true">
            {d}
          </span>
        ))}
        {weeks.flat().map((iso, i) => {
          if (iso === null) return <span key={`pad-${i}`} className="calendar-pad" />;
          const isPast = minDate !== undefined && iso < minDate;
          const isTaken = disabledDates?.has(iso) ?? false;
          const isSelected = selected.has(iso);
          const className = [
            'calendar-day',
            isSelected && 'is-selected',
            iso === today && 'is-today',
            isPast && 'is-past',
            isTaken && 'is-taken',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={iso}
              type="button"
              className={className}
              disabled={isPast || isTaken}
              aria-pressed={isSelected}
              aria-label={iso}
              onClick={() => onToggle(iso)}
            >
              {Number(iso.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
