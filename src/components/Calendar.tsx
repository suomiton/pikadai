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

interface CalendarDayProps {
  iso: string;
  today: string;
  tabStop: string | undefined;
  isSelected: boolean;
  minDate?: string;
  disabledDates?: ReadonlySet<string>;
  onFocus: (iso: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onToggle: (iso: string) => void;
}

const CalendarDay = ({
  iso,
  today,
  tabStop,
  isSelected,
  minDate,
  disabledDates,
  onFocus,
  onKeyDown,
  onToggle,
}: CalendarDayProps) => {
  const isPast = minDate !== undefined && iso < minDate;
  const isTaken = disabledDates?.has(iso) ?? false;
  const unavailable = isPast || isTaken;
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
      type="button"
      className={className}
      data-iso={iso}
      tabIndex={iso === tabStop ? 0 : -1}
      aria-disabled={unavailable || undefined}
      aria-pressed={isSelected}
      aria-label={`${formatDateLong(iso)}${note}`}
      onFocus={() => onFocus(iso)}
      onKeyDown={onKeyDown}
      onClick={() => {
        onFocus(iso);
        if (!unavailable) onToggle(iso);
      }}
    >
      {Number(iso.slice(8))}
    </button>
  );
};

interface NavigationProps {
  id: string;
  cursor: MonthCursor;
  onMove: (delta: number) => void;
}

const CalendarNavigation = ({ id, cursor, onMove }: NavigationProps) => (
  <div className="calendar-head">
    <button type="button" className="icon-btn" onClick={() => onMove(-1)} aria-label="Previous month">
      ‹
    </button>
    <span className="calendar-title" id={`${id}-title`} aria-live="polite">
      {formatMonth(cursor)}
    </span>
    <button type="button" className="icon-btn" onClick={() => onMove(1)} aria-label="Next month">
      ›
    </button>
  </div>
);

const dateForKey = (from: string, key: string): string | null => {
  const weekday = (parseIso(from).getDay() + 6) % 7; // 0 = Monday
  switch (key) {
    case 'ArrowRight':
      return addDays(from, 1);
    case 'ArrowLeft':
      return addDays(from, -1);
    case 'ArrowDown':
      return addDays(from, 7);
    case 'ArrowUp':
      return addDays(from, -7);
    case 'Home':
      return addDays(from, -weekday);
    case 'End':
      return addDays(from, 6 - weekday);
    case 'PageUp':
      return addMonths(from, -1);
    case 'PageDown':
      return addMonths(from, 1);
    default:
      return null;
  }
};

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

  const moveFocus = (iso: string) => {
    pendingFocus.current = true;
    setFocusIso(iso);
    const target = monthOf(iso);
    if (!sameMonth(target, cursor)) setCursor(target);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const from = e.currentTarget.dataset.iso;
    const to = from ? dateForKey(from, e.key) : null;
    if (to === null) return;
    e.preventDefault();
    moveFocus(to);
  };

  return (
    <div className="calendar">
      <CalendarNavigation id={id} cursor={cursor} onMove={(delta) => setCursor((c) => shiftMonth(c, delta))} />

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
        {weeks
          .flat()
          .map((iso, i) =>
            iso === null ? (
              <span key={`pad-${i}`} className="calendar-pad" />
            ) : (
              <CalendarDay
                key={iso}
                iso={iso}
                today={today}
                tabStop={tabStop}
                isSelected={selected.has(iso)}
                minDate={minDate}
                disabledDates={disabledDates}
                onFocus={setFocusIso}
                onKeyDown={onKeyDown}
                onToggle={onToggle}
              />
            ),
          )}
      </div>
    </div>
  );
}
