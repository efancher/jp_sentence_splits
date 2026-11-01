import { describe, expect, it } from 'vitest';

import {
  chooseSentencesForWeakWords,
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
