import { describe, expect, it } from 'vitest';

import {
  chooseSentencesForWeakWords,
  planWeakWordSentences,
  rankAtRiskWords,
  wordStrength,
  type WordEvidence,
} from '../src/lib/wordStrength';

const NOW = Date.UTC(2026, 10, 1);
const DAY = 86_400_000;

function ev(partial: Partial<WordEvidence> & Pick<WordEvidence, 'kind' | 'facet'>): WordEvidence {
  return { wordId: 'w', at: NOW, ...partial };
}

describe('wordStrength', () => {
  it('is zero with no evidence', () => {
    expect(wordStrength([], 'reading', NOW)).toBe(0);
    expect(wordStrength([], 'meaning', NOW)).toBe(0);
  });

  it('grows with successful recall and fades with age', () => {
    const one = wordStrength([ev({ kind: 'recall', facet: 'reading', success: true })], 'reading', NOW);
    const two = wordStrength(
      [ev({ kind: 'recall', facet: 'reading', success: true }), ev({ kind: 'recall', facet: 'reading', success: true })],
      'reading',
      NOW,
    );
    const old = wordStrength([ev({ kind: 'recall', facet: 'reading', success: true, at: NOW - 60 * DAY })], 'reading', NOW);
    expect(one).toBeCloseTo(0.63, 2);
    expect(two).toBeGreaterThan(one);
    expect(old).toBeLessThan(one);
  });

  it('counts distinct sentences for reading exposure, with a cap', () => {
    const seen = (n: number) =>
      Array.from({ length: n }, (_, i) => ev({ kind: 'exposure', facet: 'reading', sentenceId: `s${i}` }));
    const repeated = Array.from({ length: 5 }, () => ev({ kind: 'exposure', facet: 'reading', sentenceId: 's0' }));
    expect(wordStrength(repeated, 'reading', NOW)).toBe(wordStrength(seen(1), 'reading', NOW));
    expect(wordStrength(seen(5), 'reading', NOW)).toBeGreaterThan(wordStrength(seen(1), 'reading', NOW));
    expect(wordStrength(seen(9), 'reading', NOW)).toBe(wordStrength(seen(5), 'reading', NOW));
  });

  it('gives meaning no credit for exposure', () => {
    const exposure = Array.from({ length: 6 }, (_, i) => ev({ kind: 'exposure', facet: 'meaning', sentenceId: `s${i}` }));
    expect(wordStrength(exposure, 'meaning', NOW)).toBe(0);
  });

  it('barely credits a right multiple-choice pick but penalises a wrong one', () => {
    const right = wordStrength([ev({ kind: 'recognition', facet: 'meaning', success: true })], 'meaning', NOW);
    const recall = wordStrength([ev({ kind: 'recall', facet: 'meaning', success: true })], 'meaning', NOW);
    expect(right).toBeLessThan(recall / 4);
    const wrongThenRecall = wordStrength(
      [ev({ kind: 'recognition', facet: 'meaning', success: false }), ev({ kind: 'recall', facet: 'meaning', success: true })],
      'meaning',
      NOW,
    );
    expect(wrongThenRecall).toBeLessThan(recall);
  });

  it('lets many old failures fade back toward the prior instead of pinning at zero', () => {
    const failures = (ageDays: number) =>
      Array.from({ length: 15 }, () => ev({ kind: 'recall', facet: 'reading', success: false, at: NOW - ageDays * DAY }));
    const recent = wordStrength(failures(1), 'reading', NOW, { prior: 0.8 });
    const old = wordStrength(failures(90), 'reading', NOW, { prior: 0.8 });
    expect(recent).toBe(0);
    expect(old).toBeGreaterThan(0.4);
  });

  it('never drops below zero after failures, and keeps facets separate', () => {
    const evidence = [
      ev({ kind: 'recall', facet: 'reading', success: false }),
      ev({ kind: 'recall', facet: 'meaning', success: true }),
    ];
    expect(wordStrength(evidence, 'reading', NOW)).toBe(0);
    expect(wordStrength(evidence, 'meaning', NOW)).toBeGreaterThan(0.5);
  });
});

describe('rankAtRiskWords', () => {
  it('ranks weakest first and includes words with no evidence', () => {
    const byWord = new Map<string, WordEvidence[]>([
      ['strong', [ev({ wordId: 'strong', kind: 'recall', facet: 'reading', success: true }), ev({ wordId: 'strong', kind: 'recall', facet: 'meaning', success: true })]],
    ]);
    const ranked = rankAtRiskWords(['strong', 'new'], byWord, NOW);
    expect(ranked[0]).toMatchObject({ wordId: 'new', strength: 0 });
    expect(ranked.at(-1)!.wordId).toBe('strong');
    expect(rankAtRiskWords(['strong', 'new'], byWord, NOW, { facets: ['reading'], limit: 1 })).toHaveLength(1);
  });
});

describe('planWeakWordSentences', () => {
  const strength = new Map([['a', 0], ['b', 0.1], ['c', 0.8], ['d', 0.95]]);
  const sentences = [
    { sentenceId: 's1', wordIds: ['c', 'd'] },
    { sentenceId: 's2', wordIds: ['a', 'c'] },
    { sentenceId: 's3', wordIds: ['b', 'd'] },
  ];

  it('ignores slightly shaky words and lists the weakest words first', () => {
    const plan = planWeakWordSentences(sentences, strength, { limit: 5 });
    expect(plan.order).toEqual(['s2', 's3']);
    expect(plan.weakWordsBySentence.get('s2')).toEqual(['a']);
    expect(plan.weakWordsBySentence.get('s3')).toEqual(['b']);
  });

  it('returns nothing when no word is weak enough', () => {
    expect(planWeakWordSentences(sentences, new Map([['a', 0.9]])).order).toEqual([]);
  });
});

describe('chooseSentencesForWeakWords', () => {
  const weakness = new Map([['a', 1], ['b', 0.9], ['c', 0.2]]);

  it('prefers the sentence covering the most weakness, then new words, not repeats', () => {
    const sentences = [
      { sentenceId: 's1', wordIds: ['a', 'c'] },
      { sentenceId: 's2', wordIds: ['a'] },
      { sentenceId: 's3', wordIds: ['b'] },
    ];
    expect(chooseSentencesForWeakWords(sentences, weakness, 2)).toEqual(['s1', 's3']);
  });

  it('stops once nothing weak is left uncovered', () => {
    const sentences = [
      { sentenceId: 's1', wordIds: ['a'] },
      { sentenceId: 's2', wordIds: ['a'] },
    ];
    expect(chooseSentencesForWeakWords(sentences, weakness, 5)).toEqual(['s1']);
  });
});
