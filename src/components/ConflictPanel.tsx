import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';

import { listOpenConflicts } from '../sync/queue';
import {
  applyBulkConflictResolution,
  applyConflictResolution,
  type ConflictResolution,
} from '../sync/resolveConflict';
import type { SyncConflict } from '../sync/types';
import { useSync } from '../sync/SyncProvider';

function summarize(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2).slice(0, 1200);
  } catch {
    return String(payload);
  }
}

export function ConflictPanel() {
  const sync = useSync();
  const conflicts = useLiveQuery(() => listOpenConflicts(), []) ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!conflicts.length) return null;

  const busy = busyId !== null;

  async function resolve(
    conflict: SyncConflict,
    resolution: ConflictResolution,
  ): Promise<void> {
    setBusyId(conflict.id);
    try {
      await applyConflictResolution(conflict, resolution);
      await sync.syncNow();
    } finally {
      setBusyId(null);
    }
  }

  async function resolveAll(
    resolution: 'keep_local' | 'keep_remote',
  ): Promise<void> {
    const label =
      resolution === 'keep_local'
        ? 'Keep this device’s version for every conflict?'
        : 'Keep the cloud version for every conflict?';
    const confirmed = window.confirm(
      `${label}\n\nThis applies to all ${conflicts.length} open conflict(s). You can still review individual items below if you cancel.`,
    );
    if (!confirmed) return;

    setBusyId('bulk');
    try {
      await applyBulkConflictResolution(conflicts, resolution);
      await sync.syncNow();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel stack">
      <h3 style={{ margin: 0 }}>Conflicts need attention</h3>
      <p className="muted" style={{ margin: 0 }}>
        The same record changed on this device and in the cloud. Nothing was
        overwritten automatically.
      </p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => void resolveAll('keep_local')}
        >
          Keep all local ({conflicts.length})
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void resolveAll('keep_remote')}
        >
          Keep all remote ({conflicts.length})
        </button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        Bulk resolve applies the same choice to every open conflict, then syncs
        once. Duplicate is only available per book/sentence below.
      </p>
      {conflicts.map((conflict) => (
        <div key={conflict.id} className="stack conflict-card">
          <div>
            <strong>
              {conflict.entity} · {conflict.recordId}
            </strong>
            <div className="muted">
              local v{conflict.localVersion} vs remote v{conflict.remoteVersion}
            </div>
          </div>
          <details>
            <summary>Local version</summary>
            <pre className="conflict-pre">{summarize(conflict.localPayload)}</pre>
          </details>
          <details>
            <summary>Remote version</summary>
            <pre className="conflict-pre">{summarize(conflict.remotePayload)}</pre>
          </details>
          <div className="row">
            <button
              type="button"
              disabled={busy}
              onClick={() => void resolve(conflict, 'keep_local')}
            >
              Keep local
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void resolve(conflict, 'keep_remote')}
            >
              Keep remote
            </button>
            {(conflict.entity === 'books' || conflict.entity === 'sentences') && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void resolve(conflict, 'duplicate')}
              >
                Keep both (duplicate local)
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
