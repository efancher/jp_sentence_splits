import { describe, expect, it } from 'vitest';

import type { PhraseSnapshotRow } from '../domain/types';

import { attemptPitchMetrics, buildPitchGrid, describePitchMetrics, fallIndex, levelsToRuns } from './attemptPitchGrid';

const row = (text: string, status: PhraseSnapshotRow['status']): PhraseSnapshotRow => ({
  text,
  kana: text,
  native: 'lh',
  learner: status === 'no-learner' ? null : 'lh',
  status,
  nativeLevels: [0, 1],
  learnerLevels: null,
});

describe('buildPitchGrid', () => {
  it('returns null with no snapshots', () => {
    expect(buildPitchGrid([{ id: 'a', createdAt: '1', phrases: [] }])).toBeNull();
  });

  it('orders oldest-first, follows newest columns, and counts matches', () => {
    const grid = buildPitchGrid([
      { id: 'b', createdAt: '2', phrases: [row('ab', 'match'), row('cd', 'match')] },
      { id: 'a', createdAt: '1', phrases: [row('ab', 'different'), row('xx', 'match')] },
    ])!;
    expect(grid.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(grid.columns.map((c) => c.text)).toEqual(['ab', 'cd']);
    expect(grid.rows[0]!.cells[1]).toBeNull();
    expect(grid.rows[0]).toMatchObject({ matched: 0, judged: 1 });
    expect(grid.rows[1]).toMatchObject({ matched: 2, judged: 2 });
  });

  it('excludes weak-native phrases from the judged count', () => {
    const grid = buildPitchGrid([{ id: 'a', createdAt: '1', phrases: [row('ab', 'weak-native'), row('cd', 'match')] }])!;
    expect(grid.rows[0]).toMatchObject({ matched: 1, judged: 1 });
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

describe('pitch metrics', () => {
  const p = (native: string, learner: string | null, status: PhraseSnapshotRow['status']): PhraseSnapshotRow => ({
    ...row('x', status),
    native,
    learner,
  });

  it('finds the drop position', () => {
    expect(fallIndex('lhhl')).toBe(2);
    expect(fallIndex('lhhh')).toBeNull();
    expect(fallIndex('hhll')).toBe(1);
  });

  it('counts matches and averages fall error over phrases that both fall', () => {
    const m = attemptPitchMetrics([
      p('lhll', 'lhll', 'match'),
      p('lhhl', 'lhll', 'different'),
      p('lhhh', 'lhhh', 'match'),
      p('lhl', null, 'no-learner'),
      p('lh', 'll', 'weak-native'),
    ]);
    expect(m).toEqual({ matched: 2, judged: 3, fallErrorMorae: 0.5 });
  });

  it('describes change against the previous attempt', () => {
    const line = describePitchMetrics(
      { matched: 3, judged: 4, fallErrorMorae: 1 },
      { matched: 1, judged: 4, fallErrorMorae: null },
    );
    expect(line).toBe('Pitch: 3/4 phrases match the native (+50% vs last) · drop 1.0 morae off');
  });
});
