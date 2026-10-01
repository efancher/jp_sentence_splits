import { describe, expect, it } from 'vitest';

import type { GlossDecision } from '../src/domain/types';
import { previewHeuristicChunks } from '../src/lib/analysisHelpers';
import { buildDecisions, gradeResponse, hintLadder, inferSkillState, outcomeFor, disputeCounts, type GlossChunk } from '../src/lib/glossSkill';
import { glossDecisionToRemote, remoteToGlossDecision } from '../src/sync/mappers';

function chunksOf(japanese: string): GlossChunk[] {
  const preview = previewHeuristicChunks(japanese);
  return preview.parts.map((part, index) => ({ id: `c${index}`, japanese: part, role: preview.roles[index] ?? '' }));
}

let n = 0;
function rec(overrides: Partial<GlossDecision>): GlossDecision {
  n += 1;
  return {
    id: `g${n}`, timestamp: new Date(Date.UTC(2026, 8, 1, 0, n)).toISOString(), visitId: 'v', bookId: 'b',
    sentenceId: `s${n}`, skill: 'particle', subskill: 'case', ruleKey: 'particle:を', targetText: 'ケーキを',
    levelShown: 3, firstResponse: 'object', firstCorrect: true, referenceValue: 'object', referenceConfidence: 'settled',
    hintMaxStep: 0, explanationOpened: false, vocabHelped: false, translationLevel: 1, outcome: 'independent_correct',
    ...overrides,
  };
}
const NOW = new Date(Date.UTC(2026, 8, 2));

describe('buildDecisions', () => {
  it('asks for the predicate and the を/が particles on a plain sentence', () => {
    const specs = buildDecisions(chunksOf('私がケーキを食べた。'));
    const predicate = specs.find((s) => s.skill === 'predicate')!;
    expect(predicate.targetText).toBe('食べた。');
    expect(predicate.confidence).toBe('settled');
    expect(specs.filter((s) => s.skill === 'particle').map((s) => [s.particle, s.referenceValue, s.confidence])).toEqual([
      ['が', 'subject', 'settled'], ['を', 'object', 'settled'],
    ]);
  });

  it('records は/に/で as ungraded rather than guessing', () => {
    const specs = buildDecisions(chunksOf('私は学校で食べた。'));
    const byParticle = Object.fromEntries(specs.filter((s) => s.particle).map((s) => [s.particle, s]));
    expect(byParticle['は']!.confidence).toBe('alternative');
    expect(byParticle['は']!.subskill).toBe('topic');
    expect(gradeResponse(byParticle['で']!, 'where_how')).toBeNull();
  });

  it('does not grade the predicate when there is nothing to choose between', () => {
    const specs = buildDecisions(chunksOf('食べた。'));
    expect(specs.find((s) => s.skill === 'predicate')?.confidence).toBe('compare');
  });

  it('does not grade a quote-final predicate', () => {
    const chunks: GlossChunk[] = [
      { id: 'a', japanese: '彼は', role: 'topic は' },
      { id: 'b', japanese: '行くと', role: 'engine' },
    ];
    expect(buildDecisions(chunks).find((s) => s.skill === 'predicate')?.confidence).toBe('compare');
  });

  it('skips a particle whose stored role disagrees with the heuristic', () => {
    const chunks = chunksOf('私がケーキを食べた。').map((c) => (c.japanese.endsWith('を') ? { ...c, role: 'に-car' } : c));
    expect(buildDecisions(chunks).some((s) => s.particle === 'を')).toBe(false);
  });

  it('keeps the correct option among four and is deterministic', () => {
    const a = buildDecisions(chunksOf('ケーキを食べた。'));
    const b = buildDecisions(chunksOf('ケーキを食べた。'));
    const wo = a.find((s) => s.particle === 'を')!;
    expect(wo.options).toHaveLength(4);
    expect(wo.options.some((o) => o.id === 'object')).toBe(true);
    expect(wo.options).toEqual(b.find((s) => s.particle === 'を')!.options);
  });
});

describe('hints and outcomes', () => {
  it('ladder narrows to two options at step 2 and reveals at step 3', () => {
    const wo = buildDecisions(chunksOf('ケーキを食べた。')).find((s) => s.particle === 'を')!;
    const ladder = hintLadder(wo);
    expect(ladder.map((h) => h.step)).toEqual([1, 2, 3]);
    expect(ladder[1]!.keepOptions).toHaveLength(2);
    expect(ladder[1]!.keepOptions).toContain('object');
  });

  it('only an unhinted correct first answer is independent', () => {
    expect(outcomeFor({ graded: true, hintMaxStep: 0, resolved: true })).toBe('independent_correct');
    expect(outcomeFor({ graded: true, hintMaxStep: 1, resolved: true })).toBe('assisted_correct');
    expect(outcomeFor({ graded: false, hintMaxStep: 3, resolved: true })).toBe('assisted_correct');
    expect(outcomeFor({ graded: false, hintMaxStep: 3, resolved: false })).toBe('unresolved');
    expect(outcomeFor({ graded: null, hintMaxStep: 0, resolved: true })).toBe('ungraded');
  });
});

describe('inferSkillState', () => {
  it('starts with an intro, then holds the default while evidence is sparse', () => {
    expect(inferSkillState([], 'particle', NOW)).toMatchObject({ level: 3, needsIntro: true });
    const sparse = [rec({}), rec({})];
    expect(inferSkillState(sparse, 'particle', NOW)).toMatchObject({ level: 3, needsIntro: false, gradable: 2 });
  });

  it('advances after 3 independent successes on 3 different sentences', () => {
    expect(inferSkillState([rec({}), rec({}), rec({})], 'particle', NOW).level).toBe(4);
  });

  it('does not advance on repeats of the same sentence', () => {
    const same = [rec({ sentenceId: 'x' }), rec({ sentenceId: 'x' }), rec({ sentenceId: 'x' })];
    expect(inferSkillState(same, 'particle', NOW).level).toBe(3);
  });

  it('treats assisted success as holding, never as success', () => {
    const assisted = [1, 2, 3, 4].map(() => rec({ outcome: 'assisted_correct', hintMaxStep: 1 }));
    expect(inferSkillState(assisted, 'particle', NOW).level).toBe(3);
  });

  it('a single unresolved miss never lowers support', () => {
    const records = [rec({}), rec({}), rec({ firstCorrect: false, outcome: 'unresolved' })];
    expect(inferSkillState(records, 'particle', NOW).level).toBe(3);
  });

  it('lowers support after two unresolved misses on different sentences', () => {
    const miss = () => rec({ firstCorrect: false, outcome: 'unresolved', hintMaxStep: 3 });
    expect(inferSkillState([rec({}), miss(), miss()], 'particle', NOW).level).toBe(2);
  });

  it('excludes word/form blockers, disputes, ungraded and unsettled references', () => {
    const noise = [
      rec({ firstCorrect: false, outcome: 'unresolved', blocker: 'word' }),
      rec({ firstCorrect: false, outcome: 'unresolved', blocker: 'form' }),
      rec({ outcome: 'disputed' }),
      rec({ outcome: 'ungraded', firstCorrect: null }),
      rec({ referenceConfidence: 'alternative', firstCorrect: null }),
    ];
    const state = inferSkillState(noise, 'particle', NOW);
    expect(state).toMatchObject({ level: 3, gradable: 0 });
  });

  it('keeps skills independent', () => {
    const particles = [rec({}), rec({}), rec({})];
    expect(inferSkillState(particles, 'predicate', NOW).needsIntro).toBe(true);
  });

  it('steps back one level after 45 idle days and returns after a success', () => {
    const old = [rec({}), rec({}), rec({})];
    const later = new Date(Date.UTC(2026, 10, 1));
    expect(inferSkillState(old, 'particle', later)).toMatchObject({ level: 3 });
    const recent = new Date(old[2]!.timestamp);
    recent.setUTCDate(recent.getUTCDate() + 60);
    const rusty = inferSkillState(old, 'particle', recent);
    expect(rusty.level).toBe(3);
    expect(rusty.reason).toMatch(/days since/);
    const restored = [...old, rec({ timestamp: recent.toISOString() })];
    expect(inferSkillState(restored, 'particle', recent).level).toBe(4);
  });
});

describe('disputes and mapping', () => {
  it('counts disputes per rule', () => {
    expect(disputeCounts([rec({ outcome: 'disputed', ruleKey: 'particle:が' }), rec({ outcome: 'disputed', ruleKey: 'particle:が' }), rec({})])).toEqual({ 'particle:が': 2 });
  });

  it('round-trips through the remote mapping', () => {
    const full = rec({ blocker: 'structure', hintMaxStep: 2, firstResponse: 'subject', explanationOpened: true, vocabHelped: true });
    expect(remoteToGlossDecision(glossDecisionToRemote(full, 'owner', 1))).toEqual(full);
    const ungraded = rec({ firstCorrect: null, firstResponse: undefined, outcome: 'ungraded' });
    expect(remoteToGlossDecision(glossDecisionToRemote(ungraded, 'owner', 1))).toEqual(ungraded);
  });
});
