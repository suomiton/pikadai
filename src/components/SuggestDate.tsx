import { useEffect, useMemo, useRef, useState } from 'react';
import { LIMITS } from '@shared/limits';
import type { EventView } from '@shared/types';
import { api } from '../lib/api';
import { formatDate, formatDateLong, todayIso } from '../lib/dates';
import { describeError } from '../lib/errors';
import type { ParticipantIdentity } from '../lib/storage';
import { Calendar } from './Calendar';

interface Props {
  event: EventView;
  me: ParticipantIdentity | null;
  adminToken: string | null;
  onChanged: () => Promise<void>;
}

export function SuggestDate({ event, me, adminToken, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
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
    setBusy(true);
    setError(null);
    try {
      await api.addOption(event.id, { date: picked }, { adminToken, participant: me });
      close();
      await onChanged();
      setStatus(`${formatDateLong(picked)} was added to the poll.`);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
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
      <p className="visually-hidden" role="status">
        {status}
      </p>

      {open && (
        <>
          <Calendar
            selected={selected}
            disabledDates={existing}
            minDate={todayIso()}
            onToggle={(iso) => setPicked((p) => (p === iso ? null : iso))}
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
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
