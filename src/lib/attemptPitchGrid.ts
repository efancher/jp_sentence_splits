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

/**
 * Polyline point strings for a phrase's per-mora levels (0..1, high = up), one per run of voiced
 * morae — an unvoiced mora breaks the line rather than being interpolated across. A lone voiced
 * mora yields a one-point run (drawn as a dot).
 */
export function levelsToRuns(levels: readonly (number | null)[], width: number, height: number, pad = 4): string[] {
  const runs: string[] = [];
  let current: string[] = [];
  const x = (i: number) => (levels.length <= 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (levels.length - 1));
  const y = (level: number) => pad + (1 - level) * (height - 2 * pad);
  levels.forEach((level, i) => {
    if (level === null) {
      if (current.length > 0) runs.push(current.join(' '));
      current = [];
    } else {
      current.push(`${x(i).toFixed(1)},${y(level).toFixed(1)}`);
    }
  });
  if (current.length > 0) runs.push(current.join(' '));
  return runs;
}

/** Index of the last high mora when the shape falls afterwards (the accent drop); null for flat/no-fall shapes. */
export function fallIndex(shape: string): number | null {
  const lastHigh = shape.lastIndexOf('h');
  return lastHigh >= 0 && lastHigh < shape.length - 1 ? lastHigh : null;
}

export interface AttemptPitchMetrics {
  matched: number;
  judged: number;
  /** Mean |your fall position − native fall position| in morae over phrases where both fall; null if none. */
  fallErrorMorae: number | null;
}

export function attemptPitchMetrics(phrases: readonly PhraseSnapshotRow[]): AttemptPitchMetrics {
  const judged = phrases.filter((p) => p.status !== 'weak-native' && p.status !== 'no-learner');
  const errors: number[] = [];
  for (const phrase of phrases) {
    if (!phrase.learner) continue;
    const native = fallIndex(phrase.native);
    const learner = fallIndex(phrase.learner);
    if (native !== null && learner !== null) errors.push(Math.abs(learner - native));
  }
  return {
    matched: judged.filter((p) => p.status === 'match').length,
    judged: judged.length,
    fallErrorMorae: errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : null,
  };
}

/** One plain line, with the change against the previous snapshotted attempt when there is one. */
export function describePitchMetrics(current: AttemptPitchMetrics, previous?: AttemptPitchMetrics): string {
  if (current.judged === 0) return 'Pitch: nothing measurable';
  let line = `Pitch: ${current.matched}/${current.judged} phrases match the native`;
  if (previous && previous.judged > 0) {
    const delta = Math.round((current.matched / current.judged - previous.matched / previous.judged) * 100);
    line += delta === 0 ? ' (same as last)' : ` (${delta > 0 ? '+' : ''}${delta}% vs last)`;
  }
  if (current.fallErrorMorae !== null) {
    line += ` · drop ${current.fallErrorMorae === 0 ? 'on the native’s mora' : `${current.fallErrorMorae.toFixed(1)} morae off`}`;
  }
  return line;
}
