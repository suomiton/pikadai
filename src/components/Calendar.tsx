import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  WEEKDAYS,
  WEEKDAYS_LONG,
  addDays,
  addMonths,
  formatDateLong,
  formatMonth,
  monthGrid,
  monthOf,
  parseIso,
  shiftMonth,
  todayIso,
  type MonthCursor,
} from '../lib/dates';

interface Props {
  selected: ReadonlySet<string>;
  onToggle: (iso: string) => void;
  /** Dates before this (ISO) cannot be picked. */
  minDate?: string;
  /** Dates that already exist elsewhere and cannot be picked again. */
  disabledDates?: ReadonlySet<string>;
}

const sameMonth = (a: MonthCursor, b: MonthCursor) => a.year === b.year && a.month === b.month;

export function Calendar({ selected, onToggle, minDate, disabledDates }: Props) {
  const today = todayIso();
  const id = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<MonthCursor>(() => monthOf(today));
  const weeks = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const days = useMemo(() => weeks.flat().filter((d): d is string => d !== null), [weeks]);

  /*
   * Roving tabindex: one day is in the tab order and the arrow keys move it, so the grid costs
   * one tab stop instead of thirty. `focusIso` is where the keyboard user last was; when that is
   * not in the month on screen, fall back to a selected day, today, or the first of the month.
   */
  const [focusIso, setFocusIso] = useState<string | null>(null);
  const pendingFocus = useRef(false);
  const tabStop =
    focusIso !== null && sameMonth(monthOf(focusIso), cursor)
      ? focusIso
      : (days.find((d) => selected.has(d)) ?? (sameMonth(monthOf(today), cursor) ? today : days[0]));

  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${tabStop}"]`)?.focus();
  }, [tabStop]);

  function moveFocus(iso: string) {
    pendingFocus.current = true;
    setFocusIso(iso);
    const target = monthOf(iso);
    if (!sameMonth(target, cursor)) setCursor(target);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const from = e.currentTarget.dataset.iso;
    if (!from) return;
    const weekday = (parseIso(from).getDay() + 6) % 7; // 0 = Monday
    let to: string;
    switch (e.key) {
      case 'ArrowRight':
        to = addDays(from, 1);
        break;
      case 'ArrowLeft':
        to = addDays(from, -1);
        break;
      case 'ArrowDown':
        to = addDays(from, 7);
        break;
      case 'ArrowUp':
        to = addDays(from, -7);
        break;
      case 'Home':
        to = addDays(from, -weekday);
        break;
      case 'End':
        to = addDays(from, 6 - weekday);
        break;
      case 'PageUp':
        to = addMonths(from, -1);
        break;
      case 'PageDown':
        to = addMonths(from, 1);
        break;
      default:
        return;
    }
    e.preventDefault();
    moveFocus(to);
  }

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
        <span className="calendar-title" id={`${id}-title`} aria-live="polite">
          {formatMonth(cursor)}
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setCursor((c) => shiftMonth(c, 1))}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <p id={`${id}-help`} className="visually-hidden">
        Use the arrow keys to move between days, Page Up and Page Down to change month, and Enter or Space to pick a
        day.
      </p>
      <div
        ref={gridRef}
        className="calendar-grid"
        role="group"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-help`}
      >
        {WEEKDAYS.map((short, i) => (
          <span key={short} className="calendar-weekday">
            <span aria-hidden="true">{short}</span>
            <span className="visually-hidden">{WEEKDAYS_LONG[i]}</span>
          </span>
        ))}
        {weeks.flat().map((iso, i) => {
          if (iso === null) return <span key={`pad-${i}`} className="calendar-pad" />;
          const isPast = minDate !== undefined && iso < minDate;
          const isTaken = disabledDates?.has(iso) ?? false;
          const unavailable = isPast || isTaken;
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
          const note = isTaken ? ', already in the poll' : isPast ? ', in the past' : iso === today ? ', today' : '';
          return (
            <button
              key={iso}
              type="button"
              className={className}
              data-iso={iso}
              tabIndex={iso === tabStop ? 0 : -1}
              aria-disabled={unavailable || undefined}
              aria-pressed={isSelected}
              aria-label={`${formatDateLong(iso)}${note}`}
              onFocus={() => setFocusIso(iso)}
              onKeyDown={onKeyDown}
              onClick={() => {
                setFocusIso(iso);
                if (!unavailable) onToggle(iso);
              }}
            >
              {Number(iso.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
