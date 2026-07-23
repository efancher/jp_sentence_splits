import { useState } from 'react';

import { exportFullBackup } from '../db/repository';
import { downloadText } from '../lib/worksheet';
import { useAuth } from '../sync/auth';
import {
  replaceLocalWithCloud,
  uploadAllLocalData,
} from '../sync/engine';
import { updateSyncMeta } from '../sync/queue';
import { useSync } from '../sync/SyncProvider';

export function MigrationModal() {
  const auth = useAuth();
  const sync = useSync();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!sync.migrationOpen || !auth.user) return null;

  async function backupFirst(): Promise<void> {
    const payload = await exportFullBackup();
    downloadText(
      `satori-glossbook-pre-migration-${payload.exportedAt.slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      'application/json',
    );
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="migration-title">
      <div className="modal-panel stack">
        <h2 id="migration-title" style={{ margin: 0 }}>
          Local data found
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          This device already has study data. Choose how to connect it to your
          signed-in account. Reference audio blobs stay on this device unless
          you enable audio sync later. A JSON backup is downloaded before
          destructive options.
        </p>
        {error ? <div style={{ color: 'var(--danger)' }}>{error}</div> : null}
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await uploadAllLocalData(auth.user!.id);
              sync.setMigrationOpen(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Upload local data to this account
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await updateSyncMeta({
                userId: auth.user!.id,
                migrationChoice: 'keep_local',
              });
              sync.setMigrationOpen(false);
              await sync.syncNow();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Keep local only (do not upload)
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={async () => {
            const confirmed = window.confirm(
              'Replace ALL local data with cloud data for this account? A backup will download first.',
            );
            if (!confirmed) return;
            setBusy(true);
            setError('');
            try {
              await backupFirst();
              await replaceLocalWithCloud(auth.user!.id);
              sync.setMigrationOpen(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Replace local with cloud data
        </button>
      </div>
    </div>
  );
}
