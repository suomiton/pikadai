import { useId } from 'react';
import { LIMITS } from '@shared/limits';
import { useAdminForm, type AdminFormController } from '../hooks/useAdminForm';
import { FormError } from './FormError';
import { ConfirmDialog } from './ConfirmDialog';
import { StatusAnnouncer } from './StatusAnnouncer';
import { TextField } from './TextField';
import { TopDates } from './TopDates';

const AdminDetailsForm = ({ controller }: { controller: AdminFormController }) => {
  const id = useId();
  const { form, refs, dispatch, busy, error, confirmDelete, save, close } = controller;
  const { title, description, allowSuggestions, fieldErrors } = form;
  const { titleRef, descriptionRef } = refs;
  return (
    <form className="stack" onSubmit={save} noValidate>
      <TextField
        id={`${id}-title`}
        ref={titleRef}
        label="Title"
        value={title}
        onChange={(value) => dispatch({ type: 'field', key: 'title', value })}
        error={fieldErrors.title}
        maxLength={LIMITS.titleMax}
        required
      />
      <TextField
        id={`${id}-description`}
        ref={descriptionRef}
        label="Details"
        value={description}
        onChange={(value) => dispatch({ type: 'field', key: 'description', value })}
        error={fieldErrors.description}
        multiline
        maxLength={LIMITS.descriptionMax}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={allowSuggestions}
          onChange={(e) => dispatch({ type: 'allowSuggestions', value: e.target.checked })}
        />
        <span>Participants may suggest other dates</span>
      </label>
      <FormError message={confirmDelete ? null : error} />
      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving' : 'Save'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
};

export function AdminPanel() {
  const id = useId();
  const controller = useAdminForm();
  const { form, refs, dispatch, busy, error, status, confirmDelete, setConfirmDelete, setError, destroy } = controller;
  const { open } = form;
  const { editButtonRef } = refs;
  return (
    <section className="card stack" aria-labelledby={`${id}-heading`}>
      <div className="section-head">
        <h2 id={`${id}-heading`}>Organiser</h2>
        <div className="btn-row">
          {!open && (
            <button
              ref={editButtonRef}
              type="button"
              className="btn btn-secondary"
              onClick={() => dispatch({ type: 'open' })}
              disabled={busy}
            >
              Edit details
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost danger"
            onClick={() => {
              setError(null);
              setConfirmDelete(true);
            }}
            disabled={busy}
          >
            Delete poll
          </button>
        </div>
      </div>
      <StatusAnnouncer message={status} />

      {open && <AdminDetailsForm controller={controller} />}
      {!open && !confirmDelete && <FormError message={error} />}
      <TopDates />
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this poll?"
          description="The poll and every answer in it will be permanently deleted. This cannot be undone."
          confirmLabel="Delete poll"
          busyLabel="Deleting poll…"
          busy={busy}
          error={error}
          onConfirm={destroy}
          onCancel={() => {
            setConfirmDelete(false);
            setError(null);
          }}
        />
      )}
    </section>
  );
}
