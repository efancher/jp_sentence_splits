import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState, type ReactNode } from 'react';

import { reportSyncIssue } from '../db/repository';
import { listOpenConflicts } from '../sync/queue';
import {
  summarizeBookConflict,
  type ChapterSide,
} from '../sync/bookChapterConflict';
import {
  applyBookMergeResolution,
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

const DIFF_CONTEXT_LINES = 3;
const MAX_RENDERED_ROWS = 400;

/** Keeps changed rows plus a few lines of context, collapsing long unchanged runs. */
function windowRows(rows: DiffRow[]): { shown: (DiffRow | null)[]; truncated: boolean } {
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, idx) => {
    if (row.type === 'context') return;
    const lo = Math.max(0, idx - DIFF_CONTEXT_LINES);
    const hi = Math.min(rows.length - 1, idx + DIFF_CONTEXT_LINES);
    for (let k = lo; k <= hi; k++) keep[k] = true;
  });
  const shown: (DiffRow | null)[] = [];
  let skipping = false;
  for (let idx = 0; idx < rows.length; idx++) {
    if (keep[idx]) {
      shown.push(rows[idx]);
      skipping = false;
    } else if (!skipping) {
      shown.push(null);
      skipping = true;
    }
  }
  const truncated = shown.length > MAX_RENDERED_ROWS;
  return { shown: truncated ? shown.slice(0, MAX_RENDERED_ROWS) : shown, truncated };
}

/** Renders children only while open, so collapsed sections cost nothing. */
function LazyDetails({
  summary,
  defaultOpen = false,
  children,
}: {
  summary: string;
  defaultOpen?: boolean;
  children: () => ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{summary}</summary>
      {open ? children() : null}
    </details>
  );
}

function FullJson({ value }: { value: unknown }) {
  const text = useMemo(() => prettyLines(value).join('\n'), [value]);
  return <pre className="conflict-pre">{text}</pre>;
}

function ConflictDiff({ conflict }: { conflict: SyncConflict }) {
  const { rows, changes } = useMemo(() => {
    const local = prettyLines(forDiff(conflict.localPayload, conflict.entity));
    const remote = prettyLines(forDiff(conflict.remotePayload, conflict.entity));
    const diff = diffLines(local, remote);
    return { rows: windowRows(diff), changes: countChanges(diff) };
  }, [conflict.localPayload, conflict.remotePayload, conflict.entity]);

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
        {rows.shown.map((row, idx) =>
          row ? (
            <div key={idx} className={`conflict-diff-${row.type}`}>
              {DIFF_PREFIX[row.type]}
              {row.text}
            </div>
          ) : (
            <div key={idx} className="muted">
              {'  …'}
            </div>
          ),
        )}
      </pre>
      {rows.truncated ? (
        <div className="muted" style={{ fontSize: '0.8rem' }}>
          Showing the first {MAX_RENDERED_ROWS} rows; the full versions are below.
        </div>
      ) : null}
    </div>
  );
}

const KIND_LABEL = {
  differs: 'edited on both',
  local_only: 'only on this device',
  remote_only: 'only in the cloud',
} as const;

function SideChoice({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string;
  value: ChapterSide;
  onChange: (side: ChapterSide) => void;
  disabled: boolean;
}) {
  return (
    <span className="row" style={{ gap: '0.75rem' }}>
      {(['local', 'remote'] as const).map((side) => (
        <label key={side} style={{ display: 'inline-flex', gap: '0.25rem' }}>
          <input
            type="radio"
            name={name}
            checked={value === side}
            disabled={disabled}
            onChange={() => onChange(side)}
          />
          {side === 'local' ? 'This device' : 'Cloud'}
        </label>
      ))}
    </span>
  );
}

function BookChapterChoices({
  conflict,
  disabled,
  onApply,
}: {
  conflict: SyncConflict;
  disabled: boolean;
  onApply: (choices: Record<string, ChapterSide>, fields: ChapterSide) => void;
}) {
  const summary = useMemo(
    () => summarizeBookConflict(conflict.localPayload, conflict.remotePayload),
    [conflict.localPayload, conflict.remotePayload],
  );
  const [choices, setChoices] = useState<Record<string, ChapterSide>>({});
  const [fields, setFields] = useState<ChapterSide>('remote');
  const choiceFor = (id: string): ChapterSide => choices[id] ?? 'remote';

  return (
    <div className="stack" style={{ gap: '0.5rem' }}>
      <div className="muted" style={{ fontSize: '0.85rem' }}>
        {summary.chapters.length} chapter(s) differ
        {summary.fieldChanges.length
          ? `; book details differ (${summary.fieldChanges.join(', ')})`
          : '; book details match'}
        . Pick a side for each, everything else is kept as is.
      </div>
      {summary.chapters.map((chapter) => (
        <div key={chapter.id} className="stack" style={{ gap: '0.15rem' }}>
          <strong>{chapter.title}</strong>
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            {KIND_LABEL[chapter.kind]}
            {chapter.kind !== 'differs' ? ' (choosing the other side removes it)' : ''}
          </span>
          <SideChoice
            name={`${conflict.id}-${chapter.id}`}
            value={choiceFor(chapter.id)}
            disabled={disabled}
            onChange={(side) => setChoices((prev) => ({ ...prev, [chapter.id]: side }))}
          />
        </div>
      ))}
      {summary.fieldChanges.length > 0 && (
        <div className="stack" style={{ gap: '0.15rem' }}>
          <strong>Book details</strong>
          <SideChoice
            name={`${conflict.id}-fields`}
            value={fields}
            disabled={disabled}
            onChange={setFields}
          />
        </div>
      )}
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={disabled}
          onClick={() =>
            onApply(
              Object.fromEntries(
                summary.chapters.map((c) => [c.id, choiceFor(c.id)]),
              ),
              fields,
            )
          }
        >
          Apply chapter choices
        </button>
      </div>
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
  const [reportError, setReportError] = useState('');
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());

  async function submitReport(conflict: SyncConflict): Promise<void> {
    if (!reportNote.trim() || submittingReport) return;
    setSubmittingReport(true);
    setReportError('');
    try {
      const diagnostics = await sync.buildDiagnostics();
      await reportSyncIssue({
        note: reportNote.trim(),
        diagnosticsSnapshot: diagnostics,
        conflictEntity: conflict.entity,
        conflictRecordId: conflict.recordId,
      });
      setReportingId(null);
      setReportNote('');
      setReportedIds((prev) => new Set(prev).add(conflict.id));
    } catch (error) {
      setReportError(error instanceof Error ? error.message : String(error));
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
    } finally {
      setBusyId(null);
    }
    // Sync in the background: a full push/pull/audio cycle can take a while (or
    // stall offline) and must not keep every other conflict's buttons disabled.
    void sync.syncNow();
  }

  async function resolveBookMerge(
    conflict: SyncConflict,
    choices: Record<string, ChapterSide>,
    fields: ChapterSide,
  ): Promise<void> {
    setBusyId(conflict.id);
    try {
      await applyBookMergeResolution(conflict, choices, fields);
    } finally {
      setBusyId(null);
    }
    void sync.syncNow();
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
    } finally {
      setBusyId(null);
    }
    void sync.syncNow();
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
          {conflict.entity === 'books' && (
            <BookChapterChoices
              conflict={conflict}
              disabled={busy}
              onApply={(choices, fields) =>
                void resolveBookMerge(conflict, choices, fields)
              }
            />
          )}
          <LazyDetails summary="Differences" defaultOpen={conflict.entity !== 'books'}>
            {() => <ConflictDiff conflict={conflict} />}
          </LazyDetails>
          <LazyDetails summary="Full local version">
            {() => <FullJson value={conflict.localPayload} />}
          </LazyDetails>
          <LazyDetails summary="Full remote version">
            {() => <FullJson value={conflict.remotePayload} />}
          </LazyDetails>
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
              {reportError ? <p className="error" style={{ margin: 0 }}>{reportError}</p> : null}
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
