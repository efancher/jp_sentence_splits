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

function formatRetryCountdown(seconds: number): string {
  if (seconds <= 0) return 'soon';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function SyncStatusBadge() {
  const sync = useSync();
  const label = LABELS[sync.status];
  const errorSnippet =
    sync.lastError && sync.lastError.length > 80
      ? `${sync.lastError.slice(0, 77)}…`
      : sync.lastError;
  const retryLabel =
    sync.retryInSeconds != null
      ? `retry ${formatRetryCountdown(sync.retryInSeconds)}`
      : null;

  let detail: string | null = null;
  if (sync.status === 'pending') {
    detail = [String(sync.pending), retryLabel].filter(Boolean).join(' · ');
  } else if (sync.status === 'conflict') {
    detail = String(sync.conflicts);
  } else if (sync.status === 'error') {
    const parts = [
      sync.pending > 0 ? String(sync.pending) : null,
      retryLabel,
      errorSnippet,
    ].filter(Boolean);
    detail = parts.length ? parts.join(' · ') : null;
  } else if (sync.status === 'syncing') {
    detail = sync.pending > 0 ? String(sync.pending) : null;
  } else if (sync.lastSyncAt) {
    detail = new Date(sync.lastSyncAt).toLocaleString();
  }

  const titleParts = [
    sync.lastError,
    retryLabel ? `Next auto-retry in ${formatRetryCountdown(sync.retryInSeconds!)}` : null,
    label,
  ].filter(Boolean);

  return (
    <div className="sync-status-badge" title={titleParts.join(' — ')}>
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
