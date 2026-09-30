import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb, listSentenceLearningEvents, logSentenceLearningEvent } from '../src/db/repository';
import type { SentenceLearningEvent } from '../src/domain/types';
import { describeSentenceProgress, summariseSentenceProgress, glossableWords, locateTargetSpan, maskSpan, pickCompareUses, selectSentenceTargets, sentenceWordHelp, summariseTargetActivity, type CompareSentence } from '../src/lib/sentenceLearning';

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

  it('keeps own-sentence transfer separate from practice and independence', () => {
    const withTransfer: SentenceLearningEvent[] = [
      ...events,
      { ...base, id: '7', action: 'transfer_attempt', target, outcome: 'got_it' },
      { ...base, id: '8', action: 'transfer_attempt', target, outcome: 'needed_help' },
    ];
    const summary = summariseTargetActivity(withTransfer, 'k');
    expect(summary).toMatchObject({ practised: 2, gotIt: 1, transferAttempts: 2, transferSucceeded: 1 });
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

  it('falls back to a saved vocabulary meaning (first sense, capped) when the suggestion has none', () => {
    const saved = new Map([['本', 'book; volume'], ['電気', 'x'.repeat(200)], ['読む', 'ignored: suggestion has its own']]);
    const words = glossableWords(
      [
        { expression: '本', reading: 'ほん', english: undefined, selectedByDefault: true },
        { expression: '電気', reading: 'でんき', english: '', selectedByDefault: true },
        { expression: '読む', reading: 'よむ', english: 'to read', selectedByDefault: true },
        { expression: '猫', reading: 'ねこ', english: undefined, selectedByDefault: true },
      ],
      saved,
    );
    expect(words.map((word) => word.english)).toEqual(['book', `${'x'.repeat(77)}…`, 'to read']);
  });
});

describe('sentenceWordHelp', () => {
  const suggestion = (expression: string, english?: string) => ({ expression, reading: 'r', english, selectedByDefault: true });
  it('defaults to the glossed words the learner does not know and counts unglossed unknowns', () => {
    const help = sentenceWordHelp(
      [suggestion('本', 'book'), suggestion('読む', 'to read'), suggestion('猫')],
      new Set(['本']),
    );
    expect(help.total).toBe(3);
    expect(help.newWords.map((word) => word.expression)).toEqual(['読む']);
    expect(help.allWords).toHaveLength(2);
    expect(help.unknownCount).toBe(2);
  });
  it('shows nothing extra when every word is known', () => {
    const help = sentenceWordHelp([suggestion('本', 'book')], new Set(['本']));
    expect(help.newWords).toEqual([]);
    expect(help.unknownCount).toBe(0);
  });
});

describe('selectSentenceTargets', () => {
  const ev = (key: string, outcome: 'got_it' | 'needed_help', n: number): SentenceLearningEvent => ({
    id: `${key}${outcome}${n}`, timestamp: 't', visitId: 'v', action: 'target_practice', bookId: 'b', sentenceId: 's',
    target: { kind: 'vocabulary', key, label: key }, outcome,
  });
  it('orders unpractised, then still-struggling, then mostly-known; caps and keeps the rest', () => {
    const targets = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
    const events = [ev('a', 'got_it', 1), ev('a', 'got_it', 2), ev('b', 'needed_help', 1)];
    const { shown, hidden } = selectSentenceTargets(targets, events, 3);
    expect(shown.map((t) => t.id)).toEqual(['c', 'd', 'e']);
    expect(hidden.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('gap practice', () => {
  it('masks the validated occurrence, not the first text match', () => {
    const sentence = { id: 's', japanese: '本を読んで、本を買う。', position: 1 };
    const target = { key: 'k', label: '本を', sentenceIds: ['s'], occurrences: [{ sentenceId: 's', start: 6, end: 8 }] };
    const span = locateTargetSpan(target, sentence)!;
    expect(maskSpan(sentence.japanese, span)).toBe('本を読んで、＿＿＿買う。');
    expect(locateTargetSpan({ ...target, occurrences: undefined }, sentence)).toEqual({ start: 0, end: 2 });
    expect(locateTargetSpan({ ...target, label: '猫', occurrences: undefined }, sentence)).toBeUndefined();
  });

  it('only a masked got-it counts as independent; revealed-explanation practice never does', () => {
    const base = { timestamp: 't', visitId: 'v', action: 'target_practice' as const, bookId: 'b', sentenceId: 's', target: { kind: 'vocabulary' as const, key: 'k', label: 'k' } };
    const events: SentenceLearningEvent[] = [
      { ...base, id: '1', support: 'explanation_hidden', outcome: 'got_it' },
      { ...base, id: '2', support: 'target_masked', outcome: 'got_it' },
      { ...base, id: '3', support: 'target_masked', outcome: 'needed_help' },
    ];
    const summary = summariseTargetActivity(events, 'k');
    expect(summary).toMatchObject({ practised: 3, gotIt: 2, independent: 1, neededHelp: 1 });
  });
});

describe('sentence progress', () => {
  const ev = (over: Partial<SentenceLearningEvent>): SentenceLearningEvent => ({
    id: Math.random().toString(), timestamp: '2026-09-30T10:00:00Z', visitId: 'v', action: 'target_practice',
    bookId: 'b', sentenceId: 's1', ...over,
  });

  it('summarises only that sentence, counting distinct targets and the latest gist', () => {
    const events = [
      ev({ action: 'walkthrough_completed' }),
      ev({ target: { kind: 'expression', key: 'a', label: 'a' } }),
      ev({ target: { kind: 'expression', key: 'a', label: 'a' } }),
      ev({ target: { kind: 'expression', key: 'b', label: 'b' } }),
      ev({ action: 'gist_check', outcome: 'needed_help', timestamp: '2026-09-30T10:01:00Z' }),
      ev({ action: 'gist_check', outcome: 'got_it', timestamp: '2026-09-30T10:05:00Z' }),
      ev({ sentenceId: 's2', action: 'walkthrough_completed' }),
    ];
    const progress = summariseSentenceProgress(events, 's1');
    expect(progress).toEqual({ walkedThrough: true, targetsPractised: 2, writtenAttempts: 0, spokenAttempts: 0, gist: 'got_it' });
    expect(describeSentenceProgress(progress)).toBe('walked through · 2 targets practised · gist: had it');
  });

  it('is empty without evidence', () => {
    expect(describeSentenceProgress(summariseSentenceProgress([], 's1'))).toBe('');
  });
});
