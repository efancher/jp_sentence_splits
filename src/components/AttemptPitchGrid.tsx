import { useMemo, useState } from 'react';

import type { AttemptAnalysisSummary, PhraseSnapshotRow } from '../domain/types';
import { buildPitchGrid, levelsToRuns } from '../lib/attemptPitchGrid';

const STATUS_TITLE: Record<PhraseSnapshotRow['status'], string> = {
  match: 'Matches the native',
  different: 'Differs from the native',
  flat: 'Flat — no clear high/low',
  'weak-native': 'Native pitch unclear here',
  'no-learner': 'Not measured',
};

function Shape({ shape, against }: { shape: string; against?: string }) {
  return (
    <span className="apg-shape">
      {[...shape].map((c, i) => (
        <span key={i} className="apg-mora" data-c={c} data-diff={against && against[i] !== c ? '' : undefined}>
          {c === 'h' ? 'H' : 'L'}
        </span>
      ))}
    </span>
  );
}

/** The two selected attempts in chronological order (grid rows are oldest-first). */
function orderedPair(rows: readonly { id: string }[], selected: readonly string[]): [string, string] {
  const ordered = rows.map((r) => r.id).filter((id) => selected.includes(id));
  return [ordered[0]!, ordered[1]!];
}

/**
 * Attempts × phrases: the native H/L as the header, one row per attempt, so a column that
 * stays red is a phrase you keep missing and one that turns green is fixed. Reads the
 * `phraseSnapshot` saved with each analysed attempt (older attempts appear once re-analysed).
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

  return (
    <div className="panel stack" aria-label="Pitch across attempts">
      <strong>Pitch across attempts</strong>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        Native H/L on top; each row is one attempt. Red = differs from the native.
      </p>
      <div className="apg-scroll">
        <table className="apg-table">
          <thead>
            <tr>
              <th />
              {grid.columns.map((column, index) => (
                <th key={index}>
                  <div className="jp">{column.text}</div>
                  <Shape shape={column.native} />
                </th>
              ))}
              <th>Match</th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="muted">
                  {labelFor(row.id, row.createdAt)}
                </th>
                {row.cells.map((cell, index) => (
                  <td key={index} data-status={cell?.status ?? 'none'} title={cell ? STATUS_TITLE[cell.status] : 'Not comparable'}>
                    {cell?.learner ? <Shape shape={cell.learner} against={cell.native} /> : <span className="muted">{cell ? '·' : '–'}</span>}
                  </td>
                ))}
                <td>{row.judged > 0 ? `${row.matched}/${row.judged}` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <strong style={{ fontSize: '0.9rem' }}>Overlay on the native</strong>
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
        {grid.columns.map((column, index) => (
          <figure key={index} className="apg-fig">
            <svg width={OVERLAY_W} height={OVERLAY_H} role="img" aria-label={`Pitch of ${column.text}`}>
              {levelsToRuns(column.nativeLevels, OVERLAY_W, OVERLAY_H).map((points, i) => (
                <polyline key={`n${i}`} points={points} className="apg-line apg-line-native" />
              ))}
              {grid.rows.map((row) => {
                const rank = selected.indexOf(row.id);
                const levels = row.cells[index]?.learnerLevels;
                if (rank < 0 || !levels || levels.length !== column.nativeLevels.length) return null;
                return levelsToRuns(levels, OVERLAY_W, OVERLAY_H).map((points, i) => (
                  <polyline key={`${row.id}${i}`} points={points} className="apg-line apg-line-attempt" data-rank={rank % 4} />
                ));
              })}
            </svg>
            <figcaption className="jp">{column.text}</figcaption>
          </figure>
        ))}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
        Thick line = native, thin = your attempts. Each phrase is scaled from its lowest to its highest sound, so compare
        shapes, not absolute pitch.
      </p>
    </div>
  );
}
