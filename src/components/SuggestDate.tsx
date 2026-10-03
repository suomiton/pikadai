import { useEffect, useMemo, useRef, useState } from 'react';
import { LIMITS } from '@shared/limits';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { api } from '../lib/api';
import { formatDate, formatDateLong, todayIso } from '../lib/dates';
import { usePoll, usePollActions } from '../state/AppStateProvider';
import { Calendar } from './Calendar';
import { FormError } from './FormError';
import { StatusAnnouncer } from './StatusAnnouncer';

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
  if (!isAdmin && !event.allowSuggestions) return null;
  const isFull = event.options.length >= LIMITS.optionsMax;

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
      await refresh();
    });
    if (added) setStatus(`${formatDateLong(date)} was added to the poll.`);
  }

  return (
    <section className="card stack">
      <div className="section-head">
        <h2>{isAdmin ? 'Add a date' : 'Suggest another date'}</h2>
        {!open && (
          <button
            ref={openButtonRef}
            type="button"
            className="btn btn-secondary"
            onClick={() => setOpen(true)}
            disabled={isFull}
          >
            {isFull ? 'Date limit reached' : 'Pick a date'}
          </button>
        )}
      </div>
      <StatusAnnouncer message={status} />

      {open && (
        <>
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
        </>
      )}
    </section>
  );
}
