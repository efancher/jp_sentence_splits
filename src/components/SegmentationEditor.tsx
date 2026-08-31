import {
  mergeReviewRowUp,
  removeReviewRow,
  splitReviewRow,
  type ResegmentReviewRow,
} from '../lib/resegmentPlan';
import { SegmentationWaveform } from './SegmentationWaveform';

/**
 * The reviewed-segment row list shared by the re-segment-existing-book flow
 * (`ResegmentSourcePage`) and — from the mining wizard's Segment stage
 * onward — a fresh mine. Pure presentation over `ResegmentReviewRow[]`: it
 * owns the merge-up / split / remove / edit affordances (via the pure
 * helpers in `resegmentPlan.ts`) and the "collapse rows with no study
 * progress" view, and hands every change back through `onRowsChange`. It
 * has no knowledge of the plan, the DB, or the apply path.
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
   * When set, a waveform of the whole reviewed span with draggable
   * boundary handles renders above the list (the mining wizard passes
   * `(s, e) => fetchJobAudioRange(jobId, s, e)`). Omitted = no waveform.
   */
  audioForRange?: (startMs: number, endMs: number) => Promise<Blob>;
}

export function SegmentationEditor({
  rows,
  onRowsChange,
  rowsWithProgress = NO_ROWS,
  showAllRows = false,
  disabled = false,
  audioForRange,
}: SegmentationEditorProps) {
  const filteringActive = rowsWithProgress.size > 0 && !showAllRows;
  const hiddenRowCount = filteringActive
    ? rows.length - rows.filter((_, i) => rowsWithProgress.has(i)).length
    : 0;

  const editRow = (index: number, patch: Partial<ResegmentReviewRow>) =>
    onRowsChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <>
      {audioForRange && rows.length > 0 ? (
        <SegmentationWaveform
          rows={rows}
          onRowsChange={onRowsChange}
          audioForRange={audioForRange}
          disabled={disabled}
        />
      ) : null}

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
                <button
                  type="button"
                  disabled={index === 0 || disabled}
                  onClick={() => onRowsChange(mergeReviewRowUp(rows, index))}
                >
                  Merge up
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRowsChange(splitReviewRow(rows, index))}
                >
                  Split by 。
                </button>
                <button
                  type="button"
                  disabled={disabled || rows.length === 1}
                  onClick={() => onRowsChange(removeReviewRow(rows, index))}
                >
                  Remove
                </button>
              </div>
            </div>
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
                  onClick={() => onRowsChange(removeReviewRow(rows, index))}
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
