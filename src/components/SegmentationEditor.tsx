import { useState } from 'react';

import type { SpanWaveform } from '../lib/miningApi';
import {
  mergeReviewRowUp,
  moveRowEdge,
  removeReviewRow,
  splitReviewRow,
  type ResegmentReviewRow,
} from '../lib/resegmentPlan';
import { BoundaryWaveform } from './BoundaryWaveform';
import { SpanAudioButton } from './SpanAudioButton';

/**
 * The reviewed-segment row list shared by the re-segment-existing-book flow
 * (`ResegmentSourcePage`) and — from the mining wizard's Segment stage
 * onward — a fresh mine. Pure presentation over `ResegmentReviewRow[]`: it
 * owns the merge-up / split / remove / edit affordances (via the pure
 * helpers in `resegmentPlan.ts`) and the "collapse rows with no study
 * progress" view, and hands every change back through `onRowsChange`. It
 * has no knowledge of the plan, the DB, or the apply path.
 *
 * Boundary timing is tuned one row at a time (`waveformForRange` set): each
 * full row has an "Adjust timing" toggle that opens a zoomed
 * `<BoundaryWaveform>` for that sentence — a whole-span strip is unreadable
 * for a multi-minute podcast.
 */

const NO_ROWS: ReadonlySet<number> = new Set();

interface SegmentationEditorProps {
  rows: ResegmentReviewRow[];
  onRowsChange: (rows: ResegmentReviewRow[]) => void;
  /**
   * Indexes of rows that carry study progress. When non-empty and
   * `showAllRows` is false, only those rows render in full (with the
   * merge/split/remove controls); the rest collapse to a one-line list.
   * Empty (a fresh mine) always shows every row in full.
   */
  rowsWithProgress?: ReadonlySet<number>;
  showAllRows?: boolean;
  /** Freeze all editing while an apply/commit is in flight. */
  disabled?: boolean;
  /**
   * When set, each row gets a play button for its span (the mining wizard
   * passes `(s, e) => fetchJobAudioRange(jobId, s, e)`). Omitted = no
   * per-row audio.
   */
  audioForRange?: (startMs: number, endMs: number) => Promise<Blob>;
  /**
   * When set, each full row gets an "Adjust timing" toggle that opens a
   * zoomed boundary waveform (the mining wizard passes
   * `(s, e) => fetchJobWaveform(jobId, s, e)`). Omitted = no timing editor.
   */
  waveformForRange?: (startMs: number, endMs: number) => Promise<SpanWaveform>;
  /** Source duration in ms, if known — the ceiling for the last row's end
   * edit. Falls back to a generous margin past the current end. */
  mediaDurationMs?: number;
}

export function SegmentationEditor({
  rows,
  onRowsChange,
  rowsWithProgress = NO_ROWS,
  showAllRows = false,
  disabled = false,
  audioForRange,
  waveformForRange,
  mediaDurationMs,
}: SegmentationEditorProps) {
  const filteringActive = rowsWithProgress.size > 0 && !showAllRows;
  const hiddenRowCount = filteringActive
    ? rows.length - rows.filter((_, i) => rowsWithProgress.has(i)).length
    : 0;

  // Index of the row whose timing editor is open (one at a time). Cleared on
  // any structural change since indexes shift.
  const [tuningRow, setTuningRow] = useState<number | null>(null);
  const change = (next: ResegmentReviewRow[]) => {
    setTuningRow(null);
    onRowsChange(next);
  };

  const editRow = (index: number, patch: Partial<ResegmentReviewRow>) =>
    onRowsChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <>
      {rows.map((row, index) =>
        !filteringActive || rowsWithProgress.has(index) ? (
          <section className="panel stack" key={index}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">
                #{index + 1} · from original{' '}
                {row.sourceIndexes.map((i) => i + 1).join(', ')}
                {rowsWithProgress.has(index) ? ' · has study progress' : ''}
              </span>
              <div className="row">
                {audioForRange ? (
                  <SpanAudioButton
                    fetchAudio={() => audioForRange(row.startMs, row.endMs)}
                    cacheKey={`${row.startMs}-${row.endMs}`}
                    disabled={disabled}
                  />
                ) : null}
                {waveformForRange ? (
                  <button
                    type="button"
                    disabled={disabled}
                    aria-expanded={tuningRow === index}
                    onClick={() =>
                      setTuningRow((current) => (current === index ? null : index))
                    }
                  >
                    {tuningRow === index ? 'Done' : 'Adjust timing'}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={index === 0 || disabled}
                  onClick={() => change(mergeReviewRowUp(rows, index))}
                >
                  Merge up
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => change(splitReviewRow(rows, index))}
                >
                  Split by 。
                </button>
                <button
                  type="button"
                  disabled={disabled || rows.length === 1}
                  onClick={() => change(removeReviewRow(rows, index))}
                >
                  Remove
                </button>
              </div>
            </div>
            {waveformForRange && tuningRow === index ? (
              <BoundaryWaveform
                startMs={row.startMs}
                endMs={row.endMs}
                minStartMs={index > 0 ? rows[index - 1]!.startMs + 1 : 0}
                maxEndMs={
                  index < rows.length - 1
                    ? rows[index + 1]!.endMs - 1
                    : (mediaDurationMs ?? row.endMs + 300_000)
                }
                padStartMs={index === 0 ? Math.min(row.startMs, 8000) : undefined}
                padEndMs={index === rows.length - 1 ? 8000 : undefined}
                waveformForRange={waveformForRange}
                audioForRange={audioForRange}
                onStartChange={(ms) => onRowsChange(moveRowEdge(rows, index, 'start', ms))}
                onEndChange={(ms) => onRowsChange(moveRowEdge(rows, index, 'end', ms))}
                disabled={disabled}
              />
            ) : null}
            <textarea
              className="jp"
              rows={2}
              value={row.japanese}
              disabled={disabled}
              onChange={(event) => editRow(index, { japanese: event.target.value })}
            />
            <label>
              Translation
              <input
                value={row.translation}
                disabled={disabled}
                onChange={(event) =>
                  editRow(index, {
                    translation: event.target.value,
                    needsTranslationReview: false,
                  })
                }
                style={
                  row.needsTranslationReview
                    ? { borderColor: 'var(--warning)' }
                    : undefined
                }
              />
            </label>
            {row.needsTranslationReview ? (
              <span className="muted" style={{ color: 'var(--warning)' }}>
                verify translation
              </span>
            ) : null}
            {row.sourceTranslations.length > 0 &&
            !row.sourceTranslations.includes(row.translation.trim()) ? (
              <span className="muted" style={{ fontSize: '0.85em' }}>
                original: {row.sourceTranslations.join(' / ')}
              </span>
            ) : null}
          </section>
        ) : null,
      )}

      {filteringActive && hiddenRowCount > 0 ? (
        <section className="panel stack">
          <span className="muted">
            {hiddenRowCount} other sentence{hiddenRowCount === 1 ? '' : 's'} — no
            study progress, will apply with the seeded translation.
          </span>
          {rows.map((row, index) =>
            rowsWithProgress.has(index) ? null : (
              <div
                key={index}
                className="row"
                style={{ justifyContent: 'space-between', gap: '0.5rem' }}
              >
                <span className="jp jp-sm">{row.japanese}</span>
                <span
                  className="muted"
                  style={{
                    fontSize: '0.85em',
                    color: row.needsTranslationReview
                      ? 'var(--warning)'
                      : undefined,
                  }}
                >
                  {row.translation || '—'}
                </span>
                <button
                  type="button"
                  disabled={disabled || rows.length === 1}
                  onClick={() => change(removeReviewRow(rows, index))}
                >
                  Remove
                </button>
              </div>
            ),
          )}
        </section>
      ) : null}
    </>
  );
}
