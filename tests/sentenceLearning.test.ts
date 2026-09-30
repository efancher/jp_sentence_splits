import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb, listSentenceLearningEvents, logSentenceLearningEvent } from '../src/db/repository';
import type { SentenceLearningEvent } from '../src/domain/types';
import { glossableWords, pickCompareUses, summariseTargetActivity, type CompareSentence } from '../src/lib/sentenceLearning';

const sentences: CompareSentence[] = [
  { id: 'a', japanese: '本を読みます。', position: 1 },
  { id: 'b', japanese: '本を買いました。', position: 2 },
  { id: 'c', japanese: '電気を消した。', position: 3 },
  { id: 'd', japanese: 'また本を読む。', position: 4 },
];

describe('pickCompareUses', () => {
  const target = { key: 'v', label: '本', sentenceIds: ['a', 'b', 'd'] };

  it('pairs the current sentence with the nearest other real occurrence', () => {
    const pair = pickCompareUses(target, sentences, 'a', new Set())!;
    expect(pair.current.sentenceId).toBe('a');
    expect(pair.other.sentenceId).toBe('b');
    expect(pair.other.span).toEqual({ start: 0, end: 1 });
    expect(pair.remainingUnseen).toBe(1);
  });

  it('prefers an example that has not been shown, then falls back to the nearest', () => {
    expect(pickCompareUses(target, sentences, 'a', new Set(['b']))!.other.sentenceId).toBe('d');
    const all = pickCompareUses(target, sentences, 'a', new Set(['b', 'd']))!;
    expect(all.other.sentenceId).toBe('b');
    expect(all.remainingUnseen).toBe(0);
  });

  it('returns nothing when there is no second real occurrence', () => {
    expect(pickCompareUses({ ...target, sentenceIds: ['a'] }, sentences, 'a', new Set())).toBeUndefined();
    expect(pickCompareUses(target, sentences, 'missing', new Set())).toBeUndefined();
    expect(pickCompareUses({ ...target, sentenceIds: ['a', 'ghost'] }, sentences, 'a', new Set())).toBeUndefined();
  });

  it('uses the validated span for repeated text, and leaves no highlight when the label is absent', () => {
    const repeated: CompareSentence[] = [
      { id: 'r1', japanese: 'を見てを聞く。', position: 1 },
      { id: 'r2', japanese: '電気を消した。', position: 2 },
    ];
    const pair = pickCompareUses(
      { key: 'k', label: 'を', sentenceIds: ['r1', 'r2'], occurrences: [{ sentenceId: 'r1', start: 4, end: 5 }] },
      repeated, 'r1', new Set(),
    )!;
    expect(pair.current.span).toEqual({ start: 4, end: 5 });
    expect(pair.other.span).toEqual({ start: 2, end: 3 });
    const none = pickCompareUses({ key: 'k', label: '猫', sentenceIds: ['r1', 'r2'] }, repeated, 'r1', new Set())!;
    expect(none.other.span).toBeUndefined();
  });
});

describe('summariseTargetActivity', () => {
  const base = { visitId: 'v', bookId: 'b', sentenceId: 'a', timestamp: 't' } as const;
  const target = { kind: 'vocabulary' as const, key: 'k', label: '本' };
  const events: SentenceLearningEvent[] = [
    { ...base, id: '1', action: 'target_practice', target, outcome: 'got_it' },
    { ...base, id: '2', action: 'target_practice', target, outcome: 'needed_help' },
    { ...base, id: '3', action: 'compare_uses_viewed', target, exposedSentenceId: 'b' },
    { ...base, id: '4', action: 'compare_uses_viewed', target, exposedSentenceId: 'b' },
    { ...base, id: '5', action: 'target_practice', target: { ...target, key: 'other' }, outcome: 'got_it' },
    { ...base, id: '6', action: 'walkthrough_opened' },
  ];
  it('counts only the named target, and a repeated comparison is one example', () => {
    const summary = summariseTargetActivity(events, 'k');
    expect(summary).toMatchObject({ practised: 2, gotIt: 1, neededHelp: 1 });
    expect([...summary.comparedSentenceIds]).toEqual(['b']);
  });
});

describe('logSentenceLearningEvent', () => {
  beforeEach(() => {
    resetDbForTests(`sl-events-${Math.random()}`);
  });

  it('is idempotent on the event id and never writes reviews or study items', async () => {
    const input = { id: 'e1', visitId: 'v1', action: 'walkthrough_opened' as const, bookId: 'b1', sentenceId: 's1' };
    const first = await logSentenceLearningEvent(input);
    const again = await logSentenceLearningEvent({ ...input, quietMode: true });
    expect(again.timestamp).toBe(first.timestamp);
    expect(again.quietMode).toBeUndefined();
    expect(await listSentenceLearningEvents('b1')).toHaveLength(1);
    expect(await listSentenceLearningEvents('other')).toHaveLength(0);
    expect(await getDb().reviews.count()).toBe(0);
    expect(await getDb().studyItems.count()).toBe(0);
  });
});

describe('glossableWords', () => {
  it('keeps glossed content words once each and drops function words and unglossed ones', () => {
    const suggestion = (expression: string, english: string | undefined, selectedByDefault = true) =>
      ({ expression, reading: 'r', english, selectedByDefault });
    expect(
      glossableWords([
        suggestion('読む', 'to read'),
        suggestion('読む', 'to read (again)'),
        suggestion('を', 'object marker', false),
        suggestion('本', undefined),
        suggestion('買う', '  to buy '),
      ]).map((word) => `${word.expression}:${word.english}`),
    ).toEqual(['読む:to read', '買う:to buy']);
  });
});
