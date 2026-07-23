import { useSync } from '../sync/SyncProvider';
import type { SyncStatus } from '../sync/types';

const LABELS: Record<SyncStatus, string> = {
  local_only: 'Local only',
  signed_out: 'Signed out',
  offline: 'Offline',
  syncing: 'Syncing…',
  synced: 'Synced',
  pending: 'Pending changes',
  error: 'Sync error',
  conflict: 'Conflicts',
};

export function SyncStatusBadge() {
  const sync = useSync();
  const label = LABELS[sync.status];
  const detail =
    sync.status === 'pending'
      ? `${sync.pending}`
      : sync.status === 'conflict'
        ? `${sync.conflicts}`
        : sync.lastSyncAt
          ? new Date(sync.lastSyncAt).toLocaleString()
          : null;

  return (
    <div className="sync-status-badge" title={sync.lastError ?? label}>
      <span className={`sync-dot sync-dot-${sync.status}`} aria-hidden />
      <span>{label}</span>
      {detail ? <span className="muted sync-detail">{detail}</span> : null}
      {(sync.status === 'error' ||
        sync.status === 'pending' ||
        sync.status === 'offline') &&
      sync.online ? (
        <button type="button" className="ghost sync-retry" onClick={() => void sync.syncNow()}>
          Sync now
        </button>
      ) : null}
    </div>
  );
}
