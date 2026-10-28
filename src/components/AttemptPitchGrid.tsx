import { useMemo, useState } from 'react';

import type { AttemptAnalysisSummary } from '../domain/types';
import { buildPitchGrid, contourRange, isMeasured, contourToLevels, levelsToRuns, selfScaledLevels } from '../lib/attemptPitchGrid';

const GAP_REASON = {
  phones: 'the aligner couldn’t read its sounds',
  short: 'a single sound has no shape',
  unvoiced: 'too little voiced pitch in the native',
  outside: 'outside the part of the clip you practised',
} as const;

/** The two selected attempts in chronological order (grid rows are oldest-first). */
function orderedPair(rows: readonly { id: string }[], selected: readonly string[]): [string, string] {
  const ordered = rows.map((r) => r.id).filter((id) => selected.includes(id));
  return [ordered[0]!, ordered[1]!];
}

/**
 * Your attempts drawn over the native, one small chart per phrase: the measured pitch contour, not
 * a labelled shape. Pick which attempts to overlay (default first and latest) so a phrase you keep
 * missing — or one that has come into line — shows in the lines. Reads the `phraseSnapshot` saved
 * with each analysed attempt (older attempts appear once re-analysed).
 */
export function AttemptPitchGrid({
  summaries,
  labelFor,
  playing,
  onCompare,
  onStop,
}: {
  summaries: readonly AttemptAnalysisSummary[];
  labelFor: (attemptId: string, createdAt: string) => string;
  playing: boolean;
  onCompare: (firstId: string, secondId: string) => void;
  onStop: () => void;
}) {
  const grid = useMemo(
    () =>
      buildPitchGrid(
        summaries.flatMap((s) => (s.phraseSnapshot ? [{ id: s.id, createdAt: s.createdAt, phrases: s.phraseSnapshot }] : [])),
      ),
    [summaries],
  );
  const [picked, setPicked] = useState<string[] | null>(null);
  if (!grid || grid.rows.length < 2) return null;
  const lastRow = grid.rows[grid.rows.length - 1]!;
  const selected = picked ?? [grid.rows[0]!.id, lastRow.id];
  const toggle = (id: string) =>
    setPicked(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const OVERLAY_W = 120;
  const OVERLAY_H = 56;
  const hasContours = grid.columns.every((c) => !isMeasured(c) || c.nativeContour);
  const contourScale = hasContours
    ? contourRange([
        ...grid.columns.map((c) => c.nativeContour),
        ...selected.flatMap((id) => grid.rows.find((r) => r.id === id)?.cells.map((c) => c?.learnerContour) ?? []),
      ])
    : null;
  const strips = [
    { id: 'native', rank: -1 },
    ...selected.flatMap((id) => (grid.rows.some((r) => r.id === id) ? [{ id, rank: selected.indexOf(id) }] : [])),
  ];

  return (
    <div className="panel stack" aria-label="Pitch across attempts">
      <strong>Pitch across attempts</strong>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        The native’s measured pitch with your attempts laid over it, phrase by phrase.
      </p>
      <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        {grid.rows.map((row) => {
          const rank = selected.indexOf(row.id);
          return (
            <label key={row.id} className="apg-pick">
              <input type="checkbox" checked={rank >= 0} onChange={() => toggle(row.id)} />
              <span className="apg-swatch" data-rank={rank >= 0 ? rank % 4 : undefined} />
              {labelFor(row.id, row.createdAt)}
            </label>
          );
        })}
      </div>
      {selected.length === 2 ? (
        <div className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={() => (playing ? onStop() : onCompare(...orderedPair(grid.rows, selected)))}
          >
            {playing ? 'Stop' : 'Hear them back to back'}
          </button>
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            Earlier first, then later, at your current speed.
          </span>
        </div>
      ) : null}
      <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-start' }}>
        {grid.columns.map((column, index) =>
          !isMeasured(column) ? null : (
          <figure key={index} className="apg-fig">
            <svg width={OVERLAY_W} height={OVERLAY_H} role="img" aria-label={`Pitch of ${column.text}`}>
              {levelsToRuns(
                column.nativeContour ? selfScaledLevels(column.nativeContour) : column.nativeLevels,
                OVERLAY_W,
                OVERLAY_H,
              ).map((points, i) => (
                <polyline key={`n${i}`} points={points} className="apg-line apg-line-native" />
              ))}
              {grid.rows.map((row) => {
                const rank = selected.indexOf(row.id);
                const cell = row.cells[index];
                // Same sampling as the native line, so a devoiced mora doesn't leave a hole in one and not the other.
                const levels =
                  column.nativeContour && cell?.learnerContour?.length === column.nativeContour.length
                    ? selfScaledLevels(cell.learnerContour)
                    : cell?.learnerLevels;
                if (rank < 0 || !levels || levels.length !== (column.nativeContour ? column.nativeContour.length : column.nativeLevels.length)) return null;
                return levelsToRuns(levels, OVERLAY_W, OVERLAY_H).map((points, i) => (
                  <polyline key={`${row.id}${i}`} points={points} className="apg-line apg-line-attempt" data-rank={rank % 4} />
                ));
              })}
            </svg>
            <figcaption className="jp">{column.text}</figcaption>
          </figure>
          ),
        )}
      </div>
      <strong style={{ fontSize: '0.9rem' }}>Whole sentence</strong>
      {!contourScale ? (
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          The full measured line needs a fresh analysis of these attempts — use “Add pitch comparison for earlier attempts” above if it’s showing, or analyse them again.
        </p>
      ) : (
      <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-start' }}>
        {grid.columns.map((column, index) => (
          <figure key={index} className="apg-fig">
            {strips.map((strip) => {
              const row = grid.rows.find((r) => r.id === strip.id);
              const native = strip.id === 'native';
              const contour = isMeasured(column) ? (native ? column.nativeContour : row!.cells[index]?.learnerContour) : null;
              const levels = contour ? contourToLevels(contour, contourScale) : null;
              return (
                <svg
                  key={strip.id}
                  width={OVERLAY_W}
                  height={OVERLAY_H}
                  role="img"
                  aria-label={`${native ? 'Native' : `Your ${labelFor(row!.id, row!.createdAt)}`} pitch across the sentence: ${column.text}`}
                >
                  <rect width={OVERLAY_W} height={OVERLAY_H} className={isMeasured(column) ? 'apg-seg' : 'apg-seg apg-seg-gap'} />
                  {levels && levels.length === column.nativeContour!.length
                    ? levelsToRuns(levels, OVERLAY_W, OVERLAY_H).map((points, i) => (
                        <polyline
                          key={i}
                          points={points}
                          className={native ? 'apg-line apg-line-native' : 'apg-line apg-line-attempt'}
                          data-rank={native ? undefined : strip.rank % 4}
                        />
                      ))
                    : null}
                </svg>
              );
            })}
            <figcaption className="jp">{column.text}</figcaption>
          </figure>
        ))}
      </div>
      )}
      {grid.columns.some((c) => !isMeasured(c)) ? (
        <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
          Shaded phrases ({grid.columns.filter((c) => !isMeasured(c)).map((c) => `${c.text} – ${GAP_REASON[c.unmeasured!]}`).join('; ')}) couldn’t be measured, so they have no line.
        </p>
      ) : null}
      <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
        Thick line = native, thin = your attempts. Under each phrase the whole-sentence tiles run native first, then each attempt. The grid scales each phrase on its own; the whole-sentence lines share
        one height scale across the sentence and each phrase is stretched to its sounds, so compare shapes and where they
        rise and fall.
      </p>
    </div>
  );
}
