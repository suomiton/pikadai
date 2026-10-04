import { usePoll } from '../state/AppStateProvider';
import { CopyField } from './CopyField';
import { StorageNotice } from './StorageNotice';

export function ShareBox() {
  const { id, adminToken } = usePoll();
  const participantLink = `${window.location.origin}/e/${id}`;

  return (
    <section className="card stack">
      <h2>Share</h2>
      <CopyField label="Participant link" value={participantLink} hint="Anyone with this link can answer." />
      {adminToken && (
        <>
          <CopyField
            label="Admin link"
            value={`${participantLink}#admin=${adminToken}`}
            hint="Keep this private. It grants access to edit or delete the poll; there is no account to recover it from."
          />
          <StorageNotice consequence="save your organiser link somewhere safe to keep access after this tab closes." />
        </>
      )}
    </section>
  );
}
