import { describe, expect, it } from 'vitest';

import type { PhraseSnapshotRow } from '../domain/types';

import { buildPitchGrid, levelsToRuns } from './attemptPitchGrid';

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
