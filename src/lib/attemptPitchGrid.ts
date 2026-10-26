import type { PhraseSnapshotRow } from '../domain/types';

import type { PhrasePitchResult } from './phrasePitch';

const round2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

/** Compact, storable form of a phrase-pitch result; undefined when nothing was shown. */
export function toPhraseSnapshot(result: PhrasePitchResult): PhraseSnapshotRow[] | undefined {
  if (result.rows.length === 0) return undefined;
  const measured: PhraseSnapshotRow[] = result.rows.map((row) => ({
    text: row.text,
    kana: row.kana.join(''),
    nativeLevels: row.nativeLevels.map(round2),
    learnerLevels: row.learnerLevels ? row.learnerLevels.map(round2) : null,
    nativeContour: row.nativeContour.map(round1),
    learnerContour: row.learnerContour ? row.learnerContour.map(round1) : null,
    phraseIndex: row.phraseIndex,
  }));
  const gaps: PhraseSnapshotRow[] = result.unmeasured.map((gap) => ({
    text: gap.text,
    kana: '',
    nativeLevels: [],
    learnerLevels: null,
    nativeContour: [],
    learnerContour: null,
    phraseIndex: gap.phraseIndex,
    unmeasured: gap.reason,
  }));
  return [...measured, ...gaps].sort((x, y) => x.phraseIndex! - y.phraseIndex!);
}

/** False for a phrase that could not be measured and only holds its place in the whole-sentence line. */
export const isMeasured = (row: PhraseSnapshotRow): boolean => !row.unmeasured;

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
  const rows = chronological.map(
    (attempt): PitchGridRow => ({
      id: attempt.id,
      createdAt: attempt.createdAt,
      cells: columns.map((column, index) => {
        const cell = attempt.phrases[index];
        return cell && cell.text === column.text ? cell : null;
      }),
    }),
  );
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

export interface SentenceLineSegment {
  x: number;
  width: number;
}

/**
 * Left-to-right layout of a whole sentence's phrases on one shared axis. A segment is as wide as its
 * morae need (`moraWidth` each) but never narrower than its written text (`charWidth` per character),
 * so the Japanese underneath never overlaps the next phrase.
 */
export function layoutSentenceLine(
  columns: readonly { text: string; nativeLevels: readonly unknown[] }[],
  { moraWidth = 14, charWidth = 15, gap = 6 }: { moraWidth?: number; charWidth?: number; gap?: number } = {},
): { segments: SentenceLineSegment[]; totalWidth: number } {
  let x = 0;
  const segments = columns.map((column) => {
    const width = Math.max(column.nativeLevels.length * moraWidth, [...column.text].length * charWidth + 4);
    const segment = { x, width };
    x += width + gap;
    return segment;
  });
  return { segments, totalWidth: Math.max(0, x - gap) };
}

/** Min/max of every voiced value across the given contours, or null when none is voiced. */
export function contourRange(contours: readonly (readonly (number | null)[] | null | undefined)[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const contour of contours) {
    for (const v of contour ?? []) {
      if (v === null) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return min <= max ? { min, max } : null;
}

/** Maps a semitone contour onto 0..1 (high = up) against a range shared by every line being compared. */
export function contourToLevels(contour: readonly (number | null)[], range: { min: number; max: number }): (number | null)[] {
  const span = Math.max(1, range.max - range.min);
  return contour.map((v) => (v === null ? null : (v - range.min) / span));
}
