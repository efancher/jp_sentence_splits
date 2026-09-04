import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';

import { reportSyncIssue } from '../db/repository';
import { listOpenConflicts } from '../sync/queue';
import {
  applyBulkConflictResolution,
  applyConflictResolution,
  type ConflictResolution,
} from '../sync/resolveConflict';
import type { SyncConflict } from '../sync/types';
import { useSync } from '../sync/SyncProvider';
import {
  countChanges,
  diffLines,
  forDiff,
  prettyLines,
  type DiffRow,
} from '../sync/conflictDiff';

const DIFF_PREFIX: Record<DiffRow['type'], string> = {
  context: '  ',
  add: '+ ',
  remove: '- ',
};

function ConflictDiff({ conflict }: { conflict: SyncConflict }) {
  const local = prettyLines(forDiff(conflict.localPayload));
  const remote = prettyLines(forDiff(conflict.remotePayload));
  const rows = diffLines(local, remote);
  const changes = countChanges(rows);

  return (
    <div className="stack" style={{ gap: '0.5rem' }}>
      <div className="muted" style={{ fontSize: '0.8rem' }}>
        {changes === 0
          ? 'No field-level differences after normalising keys and dropping sync bookkeeping (owner, version, updatedAt, unset-vs-null fields).'
          : `${changes} differing line(s). `}
        <span className="conflict-diff-legend conflict-diff-remove">
          − local
        </span>{' '}
        <span className="conflict-diff-legend conflict-diff-add">+ remote</span>
      </div>
      <pre className="conflict-pre conflict-diff">
        {rows.map((row, idx) => (
          <div key={idx} className={`conflict-diff-${row.type}`}>
            {DIFF_PREFIX[row.type]}
            {row.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

export function ConflictPanel() {
  const sync = useSync();
  const conflicts = useLiveQuery(() => listOpenConflicts(), []) ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportNote, setReportNote] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());

  async function submitReport(conflict: SyncConflict): Promise<void> {
    if (!reportNote.trim() || submittingReport) return;
    setSubmittingReport(true);
    try {
      const diagnostics = await sync.copyDiagnostics();
      await reportSyncIssue({
        note: reportNote.trim(),
        diagnosticsSnapshot: diagnostics,
        conflictEntity: conflict.entity,
        conflictRecordId: conflict.recordId,
      });
      setReportingId(null);
      setReportNote('');
      setReportedIds((prev) => new Set(prev).add(conflict.id));
    } finally {
      setSubmittingReport(false);
    }
  }

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
          <details open>
            <summary>Differences</summary>
            <ConflictDiff conflict={conflict} />
          </details>
          <details>
            <summary>Full local version</summary>
            <pre className="conflict-pre">
              {prettyLines(conflict.localPayload).join('\n')}
            </pre>
          </details>
          <details>
            <summary>Full remote version</summary>
            <pre className="conflict-pre">
              {prettyLines(conflict.remotePayload).join('\n')}
            </pre>
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
          {reportingId === conflict.id ? (
            <form
              className="stack"
              style={{ gap: '0.35rem' }}
              onSubmit={(event) => {
                event.preventDefault();
                void submitReport(conflict);
              }}
            >
              <textarea
                value={reportNote}
                onChange={(event) => setReportNote(event.target.value)}
                placeholder="What looks wrong about this conflict?"
                rows={2}
                autoFocus
              />
              <div className="row">
                <button type="submit" disabled={!reportNote.trim() || submittingReport}>
                  Submit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReportingId(null);
                    setReportNote('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  setReportingId(conflict.id);
                  setReportNote('');
                }}
              >
                Report this conflict
              </button>
              {reportedIds.has(conflict.id) ? (
                <span className="muted">✓ Reported</span>
              ) : null}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
