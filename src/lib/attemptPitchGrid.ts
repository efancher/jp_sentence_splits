import type { PhraseSnapshotRow } from '../domain/types';

import type { PhrasePitchResult } from './phrasePitch';

const round2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

/** Compact, storable form of a phrase-pitch result; undefined when nothing was shown. */
export function toPhraseSnapshot(result: PhrasePitchResult): PhraseSnapshotRow[] | undefined {
  if (result.rows.length === 0) return undefined;
  return result.rows.map((row) => ({
    text: row.text,
    kana: row.kana.join(''),
    native: row.native.join(''),
    learner: row.learner ? row.learner.join('') : null,
    status: row.status,
    nativeLevels: row.nativeLevels.map(round2),
    learnerLevels: row.learnerLevels ? row.learnerLevels.map(round2) : null,
  }));
}

export interface PitchGridAttempt {
  id: string;
  createdAt: string;
  phrases: PhraseSnapshotRow[];
}

export interface PitchGridRow {
  id: string;
  createdAt: string;
  /** One cell per column; null when this attempt has no matching phrase there. */
  cells: (PhraseSnapshotRow | null)[];
  /** Matching phrases out of those that had a native shape to judge (weak-native excluded). */
  matched: number;
  judged: number;
}

export interface PitchGrid {
  /** Native reference for each column, taken from the newest attempt. */
  columns: PhraseSnapshotRow[];
  rows: PitchGridRow[];
}

/**
 * Attempts × phrases. Columns follow the newest attempt's phrases; an older attempt fills a column
 * only when its phrase at that position has the same text (phrase grouping can shift between runs).
 * Rows are oldest-first.
 */
export function buildPitchGrid(attempts: readonly PitchGridAttempt[]): PitchGrid | null {
  const chronological = attempts.filter((a) => a.phrases.length > 0).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const newest = chronological[chronological.length - 1];
  if (!newest) return null;
  const columns = newest.phrases;
  const rows = chronological.map((attempt): PitchGridRow => {
    const cells = columns.map((column, index) => {
      const cell = attempt.phrases[index];
      return cell && cell.text === column.text ? cell : null;
    });
    const judged = cells.filter((c) => c && c.status !== 'weak-native');
    return {
      id: attempt.id,
      createdAt: attempt.createdAt,
      cells,
      judged: judged.length,
      matched: judged.filter((c) => c!.status === 'match').length,
    };
  });
  return { columns, rows };
}
