import { describe, expect, it } from 'vitest';

import type { Attempt, AttemptAnalysisSummary } from '../src/domain/types';
import { attemptsNeedingPhraseSnapshot } from '../src/lib/backfillPhraseSnapshots';

const attempt = (id: string) => ({ id }) as Attempt;
const summary = (id: string, withSnapshot: boolean) =>
  ({
    id,
    phraseSnapshot: withSnapshot
      ? [{ text: 'a', kana: 'a', native: 'lh', learner: 'lh', status: 'match', nativeLevels: [], learnerLevels: null }]
      : undefined,
  }) as AttemptAnalysisSummary;

describe('attemptsNeedingPhraseSnapshot', () => {
  it('picks analysed attempts that lack a snapshot, and ignores never-analysed ones', () => {
    const result = attemptsNeedingPhraseSnapshot(
      [attempt('a'), attempt('b'), attempt('c')],
      [summary('a', true), summary('b', false)],
    );
    expect(result.map((x) => x.id)).toEqual(['b']);
  });
});
