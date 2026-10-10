import { describe, expect, it } from 'vitest';

import type { PhraseSnapshotRow } from '../domain/types';

import { buildPitchGrid } from './attemptPitchGrid';

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
