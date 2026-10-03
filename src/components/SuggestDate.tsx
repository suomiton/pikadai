import { useEffect, useMemo, useRef, useState } from 'react';
import { LIMITS } from '@shared/limits';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { api } from '../lib/api';
import { formatDate, formatDateLong, todayIso } from '../lib/dates';
import { usePoll, usePollActions } from '../state/AppStateProvider';
import { Calendar } from './Calendar';
import { FormError } from './FormError';
import { StatusAnnouncer } from './StatusAnnouncer';

/**
 * The button that adds a date (organiser) or suggests one (participants), and the calendar it
 * opens. Renders into the `.btn-row` that VoteGrid puts it in, beside "Add your availability";
 * the picker takes the row's full width and wraps onto its own line. VoteGrid only renders this
 * when the viewer may add dates.
 */
export function SuggestDate() {
  const { event, me, adminToken } = usePoll();
  const { refresh } = usePollActions();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const { busy, error, setError, run } = useAsyncAction();
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  const existing = useMemo(() => new Set(event.options.map((o) => o.date)), [event.options]);
  const selected = useMemo(() => new Set(picked ? [picked] : []), [picked]);

  // The picker unmounts when it closes; put focus back on the button that opened it.
  useEffect(() => {
    if (open || !returnFocus.current) return;
    returnFocus.current = false;
    openButtonRef.current?.focus();
  }, [open]);

  const isAdmin = event.viewer.isAdmin;
  const isFull = event.options.length >= LIMITS.optionsMax;
  const label = isAdmin ? 'Add a date' : 'Suggest a date';

  function close() {
    returnFocus.current = true;
    setOpen(false);
    setPicked(null);
    setError(null);
  }

  async function add() {
    if (!picked) return;
    const date = picked;
    const added = await run(async () => {
      await api.addOption(event.id, { date }, { adminToken, participant: me });
      close();
      await refresh(event.id);
    });
    if (added) setStatus(`${formatDateLong(date)} was added to the poll.`);
  }

  return (
    <>
      {!open && (
        <button
          ref={openButtonRef}
          type="button"
          className="btn btn-secondary"
          onClick={() => setOpen(true)}
          disabled={isFull}
        >
          {isFull ? 'Date limit reached' : label}
        </button>
      )}
      <StatusAnnouncer message={status} />

      {open && (
        <div className="date-picker stack" role="group" aria-label={label}>
          <Calendar
            selected={selected}
            disabledDates={existing}
            minDate={todayIso()}
            onToggle={(iso) => setPicked((p) => (p === iso ? null : iso))}
          />
          <FormError message={error} />
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={add} disabled={!picked || busy}>
              {picked ? `Add ${formatDate(picked)}` : 'Select a date'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
