import { useMemo, useState } from 'react';
import { LIMITS } from '@shared/limits';
import type { EventView } from '@shared/types';
import { api } from '../lib/api';
import { formatDate, todayIso } from '../lib/dates';
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

  const existing = useMemo(() => new Set(event.options.map((o) => o.date)), [event.options]);
  const selected = useMemo(() => new Set(picked ? [picked] : []), [picked]);

  const isAdmin = event.viewer.isAdmin;
  if (!isAdmin && !event.allowSuggestions) return null;
  const isFull = event.options.length >= LIMITS.optionsMax;

  async function add() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await api.addOption(event.id, { date: picked }, { adminToken, participant: me });
      setPicked(null);
      setOpen(false);
      await onChanged();
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
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)} disabled={isFull}>
            {isFull ? 'Date limit reached' : 'Pick a date'}
          </button>
        )}
      </div>

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
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setOpen(false);
                setPicked(null);
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}
