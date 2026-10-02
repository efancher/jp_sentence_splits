import { describe, expect, it } from 'vitest';
import type { Review } from '../src/domain/types';
import {
  computeSequentialStatus,
  qualifyingAttempts,
  unlockProgress,
  type SequentialInputSentence,
} from '../src/lib/sequentialStudy';

const T0 = Date.parse('2026-09-01T00:00:00Z');
const at = (n: number) => new Date(T0 + n * 60 * 60 * 1000).toISOString();

function review(n: number, correct: boolean, qualifying = true): Review {
  return {
    id: `r${n}${correct}${qualifying}`,
    studyItemId: 's',
    timestamp: at(n),
    rating: correct ? 'good' : 'again',
    meaningChoice: {
      shown: ['a', 'b'],
      chosenIndex: 0,
      chosenText: 'a',
      correctText: 'a',
      correct,
      qualifying,
    },
  };
}
const run = (pattern: boolean[]) => pattern.map((c, i) => review(i, c));

function sentence(
  id: string,
  position: number,
  reviews: Review[] = [],
  extra: Partial<SequentialInputSentence> = {},
): SequentialInputSentence {
  return { sentenceId: id, position, hasUsableCheck: true, reviews, introduced: false, ...extra };
}

describe('qualifying attempts', () => {
  it('ignores non-qualifying (retry / after-help) answers', () => {
    const got = qualifyingAttempts([review(0, true), review(1, false, false), review(2, true)]);
    expect(got).toHaveLength(2);
  });

  it('drops attempts inside the minimum gap (same sitting)', () => {
    const quick: Review = { ...review(0, true), id: 'q', timestamp: new Date(T0 + 60_000).toISOString() };
    expect(qualifyingAttempts([review(0, true), quick])).toHaveLength(1);
  });

  it('treats legacy reviews as qualifying unless help was recorded; ignores check-less reviews', () => {
    const base = { studyItemId: 's', rating: 'good' as const };
    const legacyOk: Review = { ...base, id: 'a', timestamp: at(0), comprehensionCheckCorrect: true };
    const legacyHelped: Review = {
      ...base,
      id: 'b',
      timestamp: at(1),
      comprehensionCheckCorrect: true,
      assistance: ['translation_shown'],
    };
    const noCheck: Review = { ...base, id: 'c', timestamp: at(2) };
    expect(qualifyingAttempts([legacyOk, legacyHelped, noCheck])).toEqual([
      { timestamp: at(0), correct: true },
    ]);
  });
});

describe('unlock progress', () => {
  it('needs 5 attempts and 4 correct', () => {
    expect(unlockProgress(qualifyingAttempts(run([true, true, true, true]))).cleared).toBe(false);
    expect(unlockProgress(qualifyingAttempts(run([true, true, true, true, false]))).cleared).toBe(true);
    expect(unlockProgress(qualifyingAttempts(run([true, true, true, false, false]))).cleared).toBe(false);
  });

  it('stays cleared after later misses', () => {
    const p = unlockProgress(
      qualifyingAttempts(run([true, true, true, true, true, false, false, false])),
    );
    expect(p.cleared).toBe(true);
    expect(p.correctInWindow).toBe(2);
  });
});

describe('sequential status', () => {
  it('unlocks in episode (position) order regardless of input order', () => {
    const s = computeSequentialStatus([sentence('c', 3), sentence('a', 1), sentence('b', 2)]);
    expect(s.sentences.map((x) => x.sentenceId)).toEqual(['a', 'b', 'c']);
    expect(s.sentences.map((x) => x.accessible)).toEqual([true, false, false]);
    expect(s.frontier?.sentenceId).toBe('b');
    expect(s.gatingSentence?.sentenceId).toBe('a');
  });

  it('unlocks the next sentence once the previous clears, but not two ahead', () => {
    const s = computeSequentialStatus([
      sentence('a', 1, run([true, true, true, true, false])),
      sentence('b', 2),
      sentence('c', 3),
    ]);
    expect(s.sentences.map((x) => x.accessible)).toEqual([true, true, false]);
  });

  it('never relocks: latched and introduced sentences stay accessible', () => {
    const s = computeSequentialStatus(
      [sentence('a', 1), sentence('b', 2), sentence('c', 3, [], { introduced: true })],
      new Set(['b']),
    );
    expect(s.sentences.map((x) => x.accessible)).toEqual([true, true, true]);
    expect(s.newlyLatched).toEqual(['a', 'c']);
  });

  it('waives a sentence with no usable meaning check so the learner is never stuck', () => {
    const s = computeSequentialStatus([
      sentence('a', 1, [], { hasUsableCheck: false }),
      sentence('b', 2),
    ]);
    expect(s.sentences[1]!.accessible).toBe(true);
    expect(s.sentences[1]!.reason).toBe('previous_waived');
  });

  it('waiver does not chain past a locked sentence', () => {
    const s = computeSequentialStatus([
      sentence('a', 1),
      sentence('b', 2, [], { hasUsableCheck: false }),
      sentence('c', 3),
    ]);
    expect(s.sentences.map((x) => x.accessible)).toEqual([true, false, false]);
  });

  it('is independent per book: each book starts at its own first sentence', () => {
    const one = computeSequentialStatus([sentence('a1', 1), sentence('a2', 2)]);
    const two = computeSequentialStatus([sentence('b1', 1), sentence('b2', 2)]);
    expect(one.sentences[0]!.accessible && two.sentences[0]!.accessible).toBe(true);
  });

  it('legacy history: a studied sentence with only legacy reviews can clear', () => {
    const legacy = ['a', 'b', 'c', 'd', 'e'].map(
      (id, i): Review => ({
        id,
        studyItemId: 's',
        timestamp: at(i),
        rating: 'good',
        comprehensionCheckCorrect: i !== 2,
      }),
    );
    const s = computeSequentialStatus([sentence('a', 1, legacy), sentence('b', 2)]);
    expect(s.sentences[1]!.accessible).toBe(true);
  });
});
