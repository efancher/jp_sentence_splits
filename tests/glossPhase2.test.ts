import { describe, expect, it } from 'vitest';

import type { GlossDecision } from '../src/domain/types';
import { previewHeuristicChunks } from '../src/lib/analysisHelpers';
import {
  buildDecisions,
  glossReadinessTier,
  parkedSentenceIds,
  partialTranslation,
  summariseGloss,
  translationLevelFor,
} from '../src/lib/glossSkill';

let n = 0;
const rec = (o: Partial<GlossDecision>): GlossDecision => {
  n += 1;
  return {
    id: `r${n}`, timestamp: '2026-09-01T00:00:00.000Z', visitId: 'v', bookId: 'b', sentenceId: 's1',
    skill: 'particle', subskill: 'case', ruleKey: 'particle:を', targetText: 'ケーキを', levelShown: 3, firstCorrect: false,
    referenceValue: 'object', referenceConfidence: 'settled', hintMaxStep: 3, explanationOpened: false, vocabHelped: false,
    translationLevel: 1, outcome: 'unresolved', ...o,
  };
};

describe('phase 2 rules', () => {
  it('maps support level to translation level', () => {
    expect(([1, 2, 3, 4] as const).map(translationLevelFor)).toEqual([3, 2, 1, 0]);
  });

  it('builds a partial translation only from complete literal glosses', () => {
    const chunks = [
      { id: 'a', japanese: 'ケーキを', role: '', literalEnglish: 'the cake' },
      { id: 'b', japanese: '食べた', role: '', literalEnglish: 'ate' },
    ];
    expect(partialTranslation(chunks, 'a')).toBe('___ ate');
    expect(partialTranslation([chunks[0]!, { ...chunks[1]!, literalEnglish: undefined }], 'a')).toBeUndefined();
  });

  it('readiness tiers are advisory thresholds', () => {
    expect([undefined, 0.9, 0.6, 0.2].map(glossReadinessTier)).toEqual(['ready', 'ready', 'workable', 'thin']);
  });

  it('parks unresolved sentences until a later success, and not on the day touched', () => {
    const now = new Date('2026-09-05T12:00:00Z');
    expect(parkedSentenceIds([rec({})], now)).toEqual(['s1']);
    expect(parkedSentenceIds([rec({}), rec({ timestamp: '2026-09-02T00:00:00.000Z', outcome: 'assisted_correct' })], now)).toEqual([]);
    expect(parkedSentenceIds([rec({ timestamp: '2026-09-05T08:00:00.000Z' })], now)).toEqual([]);
  });

  it('self-report rows are counted but never graded', () => {
    const summary = summariseGloss([
      rec({ outcome: 'self_report', felt: 'too_hard', firstCorrect: null, referenceConfidence: 'compare', hintMaxStep: 0 }),
    ]);
    expect(summary.felt.too_hard).toBe(1);
    expect(summary.decisions).toBe(0);
  });

  it('offers a settled の attachment decision pointing at the next chunk', () => {
    const preview = previewHeuristicChunks('私の本を読んだ。');
    const chunks = preview.parts.map((japanese, i) => ({ id: `c${i}`, japanese, role: preview.roles[i] ?? '' }));
    const spec = buildDecisions(chunks).find((s) => s.skill === 'attachment');
    expect(spec?.confidence).toBe('settled');
    expect(spec?.referenceValue).toBe(chunks[chunks.findIndex((c) => c.id === spec?.chunkId) + 1]!.id);
  });
});
