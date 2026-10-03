import { usePoll } from '../state/AppStateProvider';
import { CopyField } from './CopyField';

export function ShareBox() {
  const { id, adminToken } = usePoll();
  const participantLink = `${window.location.origin}/e/${id}`;

  return (
    <section className="card stack">
      <h2>Share</h2>
      <CopyField label="Participant link" value={participantLink} hint="Anyone with this link can answer." />
      {adminToken && (
        <CopyField
          label="Admin link"
          value={`${participantLink}#admin=${adminToken}`}
          hint="Keep this private. It is the only way to edit or delete the poll; there is no account to recover it from."
        />
      )}
    </section>
  );
}
