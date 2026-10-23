import { describe, expect, it } from 'vitest';

import {
  mergedStatus,
  planStudyItemMoves,
  validateMergedText,
  withVideoPosition,
} from '../scripts/lib/mergeSentences';

describe('validateMergedText', () => {
  const first = '私は去年の9月からこのポッドキャストを始めました。';
  const second = '今は200人以上の人が聞いています。';

  it('accepts the first sentence + connective + second sentence', () => {
    const merged = '私は去年の9月からこのポッドキャストを始めましたが、今は200人以上の人が聞いています。';
    expect(validateMergedText(first, second, merged)).toEqual({ ok: true, connective: 'が' });
  });

  it('rejects a merge that rewrites either sentence', () => {
    expect(validateMergedText(first, second, '私は去年から始めましたが、今は200人以上の人が聞いています。').ok).toBe(false);
    expect(validateMergedText(first, second, '私は去年の9月からこのポッドキャストを始めましたが、今は200人の人が聞いています。').ok).toBe(false);
  });

  it('rejects anything other than a connective between the sentences', () => {
    const r = validateMergedText(first, second, '私は去年の9月からこのポッドキャストを始めましたそして、今は200人以上の人が聞いています。');
    expect(r.ok).toBe(false);
  });

  it('rejects a merge with no connective at all', () => {
    expect(validateMergedText('ABC。', 'DEF。', 'ABCDEF。').ok).toBe(false);
  });
});

describe('mergedStatus', () => {
  it('keeps the more advanced status', () => {
    expect(mergedStatus('unstarted', 'in_progress')).toBe('in_progress');
    expect(mergedStatus('complete', 'in_progress')).toBe('complete');
    expect(mergedStatus('unstarted', 'unstarted')).toBe('unstarted');
  });
});

describe('planStudyItemMoves', () => {
  const item = (id: string, subjectId: string, activityType: string, reviewCount: number, fsrsReps = 0) => ({
    id,
    subjectId,
    activityType,
    reviewCount,
    fsrsReps,
  });

  it('moves a lone card and retires the less-reviewed duplicate per activity type', () => {
    const { move, retire } = planStudyItemMoves([
      item('a1', 'A', 'reading_in_context', 1),
      item('b1', 'B', 'reading_in_context', 4),
      item('b2', 'B', 'other', 0),
    ]);
    expect(move.map((m) => m.id).sort()).toEqual(['b1', 'b2']);
    expect(retire.map((m) => m.id)).toEqual(['a1']);
  });

  it('breaks review-count ties by reps, then id', () => {
    const { move } = planStudyItemMoves([
      item('x', 'A', 't', 2, 1),
      item('y', 'B', 't', 2, 3),
    ]);
    expect(move.map((m) => m.id)).toEqual(['y']);
    expect(planStudyItemMoves([item('b', 'A', 't', 0), item('a', 'B', 't', 0)]).move[0]!.id).toBe('a');
  });

  it('returns nothing for no cards', () => {
    expect(planStudyItemMoves([])).toEqual({ move: [], retire: [] });
  });
});

describe('withVideoPosition', () => {
  it('replaces an existing position line and keeps other notes', () => {
    expect(withVideoPosition('Episode #24\nVideo position: 43.000–53.000 seconds\nTranscript status: x', 43000, 70000)).toBe(
      'Episode #24\nVideo position: 43.000–70.000 seconds\nTranscript status: x',
    );
  });
  it('appends when absent', () => {
    expect(withVideoPosition(undefined, 1000, 2500)).toBe('Video position: 1.000–2.500 seconds');
    expect(withVideoPosition('note', 1000, 2500)).toBe('note\nVideo position: 1.000–2.500 seconds');
  });
});
