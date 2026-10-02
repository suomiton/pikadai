import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { LIMITS } from '@shared/limits';
import { updateEventSchema } from '@shared/schemas';
import type { EventView } from '@shared/types';
import { api } from '../lib/api';
import { describeError } from '../lib/errors';
import { storage } from '../lib/storage';

interface Props {
  event: EventView;
  adminToken: string;
  onChanged: () => Promise<void>;
}

export function AdminPanel({ event, adminToken, onChanged }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description);
  const [allowSuggestions, setAllowSuggestions] = useState(event.allowSuggestions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setTitle(event.title);
    setDescription(event.description);
    setAllowSuggestions(event.allowSuggestions);
  }, [event, open]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = updateEventSchema.safeParse({ title, description, allowSuggestions });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid details');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateEvent(event.id, parsed.data, adminToken);
      setOpen(false);
      await onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    if (!window.confirm('Delete this poll and every answer in it? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteEvent(event.id, adminToken);
      storage.setAdminToken(event.id, null);
      storage.setParticipant(event.id, null);
      navigate('/');
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <div className="section-head">
        <h2>Organiser</h2>
        <div className="btn-row">
          {!open && (
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)} disabled={busy}>
              Edit details
            </button>
          )}
          <button type="button" className="btn btn-ghost danger" onClick={destroy} disabled={busy}>
            Delete poll
          </button>
        </div>
      </div>

      {open && (
        <form className="stack" onSubmit={save} noValidate>
          <label className="field">
            <span className="field-label">Title</span>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={LIMITS.titleMax}
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Details</span>
            <textarea
              className="input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={LIMITS.descriptionMax}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={allowSuggestions}
              onChange={(e) => setAllowSuggestions(e.target.checked)}
            />
            <span>Participants may suggest other dates</span>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving' : 'Save'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {!open && error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
