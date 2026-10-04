import { usePoll } from '../state/AppStateProvider';
import { CopyField } from './CopyField';
import { StorageNotice } from './StorageNotice';

export function ShareBox() {
  const { id, adminToken } = usePoll();
  const pollLink = `${window.location.origin}/e/${id}`;

  return (
    <section className="card stack">
      <h2>Share</h2>
      <CopyField label="Poll link" value={pollLink} hint="Share this link to invite people to answer." />
      {adminToken && (
        <>
          <CopyField
            label="Admin link"
            value={`${pollLink}#admin=${adminToken}`}
            hint="Keep this private. It grants access to edit or delete the poll; there is no account to recover it from."
          />
          <StorageNotice consequence="save your organiser link and reopen it after a reload or when this tab closes." />
        </>
      )}
    </section>
  );
}
