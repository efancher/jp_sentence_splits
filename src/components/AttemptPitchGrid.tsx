import { useMemo } from 'react';

import type { AttemptAnalysisSummary, PhraseSnapshotRow } from '../domain/types';
import { buildPitchGrid } from '../lib/attemptPitchGrid';

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

/**
 * Attempts × phrases: the native H/L as the header, one row per attempt, so a column that
 * stays red is a phrase you keep missing and one that turns green is fixed. Reads the
 * `phraseSnapshot` saved with each analysed attempt (older attempts appear once re-analysed).
 */
export function AttemptPitchGrid({
  summaries,
  labelFor,
}: {
  summaries: readonly AttemptAnalysisSummary[];
  labelFor: (attemptId: string, createdAt: string) => string;
}) {
  const grid = useMemo(
    () =>
      buildPitchGrid(
        summaries.flatMap((s) => (s.phraseSnapshot ? [{ id: s.id, createdAt: s.createdAt, phrases: s.phraseSnapshot }] : [])),
      ),
    [summaries],
  );
  if (!grid || grid.rows.length < 2) return null;

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
    </div>
  );
}
