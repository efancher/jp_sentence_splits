import { describe, expect, it } from 'vitest';

import type { PhraseSnapshotRow } from '../domain/types';

import { buildPitchGrid, contourRange, contourToLevels, layoutSentenceLine, levelsToRuns } from './attemptPitchGrid';

const row = (text: string): PhraseSnapshotRow => ({
  text,
  kana: text,
  nativeLevels: [0, 1],
  learnerLevels: [0, 1],
});

describe('buildPitchGrid', () => {
  it('returns null with no snapshots', () => {
    expect(buildPitchGrid([{ id: 'a', createdAt: '1', phrases: [] }])).toBeNull();
  });

  it('orders oldest-first and follows the newest attempt’s columns', () => {
    const grid = buildPitchGrid([
      { id: 'b', createdAt: '2', phrases: [row('ab'), row('cd')] },
      { id: 'a', createdAt: '1', phrases: [row('ab'), row('xx')] },
    ])!;
    expect(grid.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(grid.columns.map((c) => c.text)).toEqual(['ab', 'cd']);
    expect(grid.rows[0]!.cells[0]).not.toBeNull();
    expect(grid.rows[0]!.cells[1]).toBeNull();
  });
});

describe('levelsToRuns', () => {
  it('splits runs at unvoiced morae and maps high levels upward', () => {
    const runs = levelsToRuns([0, 1, null, 0.5], 100, 40, 0);
    expect(runs).toEqual(['0.0,40.0 33.3,0.0', '100.0,20.0']);
  });

  it('centres a single mora', () => {
    expect(levelsToRuns([1], 100, 40, 0)).toEqual(['50.0,0.0']);
  });
});

describe('layoutSentenceLine', () => {
  it('places phrases left to right, widening short-mora phrases to fit their text', () => {
    const { segments, totalWidth } = layoutSentenceLine(
      [
        { text: 'はい', nativeLevels: [0, 1, 0, 1, 0, 1] },
        { text: '緑色では', nativeLevels: [0, 1] },
      ],
      { moraWidth: 10, charWidth: 10, gap: 5 },
    );
    expect(segments[0]).toEqual({ x: 0, width: 60 });
    expect(segments[1]).toEqual({ x: 65, width: 44 });
    expect(totalWidth).toBe(109);
  });

  it('is empty for no phrases', () => {
    expect(layoutSentenceLine([])).toEqual({ segments: [], totalWidth: 0 });
  });
});

describe('contour helpers', () => {
  it('finds one shared range across lines and ignores unvoiced samples', () => {
    expect(contourRange([[null, -2, 1], [4, null], null])).toEqual({ min: -2, max: 4 });
    expect(contourRange([[null], undefined])).toBeNull();
  });

  it('maps semitones onto 0..1 against the shared range, keeping gaps', () => {
    expect(contourToLevels([-2, null, 4, 1], { min: -2, max: 4 })).toEqual([0, null, 1, 0.5]);
  });

  it('never stretches a near-flat range to full height', () => {
    expect(contourToLevels([0, 0.5], { min: 0, max: 0.5 })).toEqual([0, 0.5]);
  });
});
