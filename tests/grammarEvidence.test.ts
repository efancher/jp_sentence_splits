import { describe, expect, it } from 'vitest';

import { buildGrammarEvidence, grammarFeedbackTargetKey, grammarPatternStrengths, grammarStrength } from '../src/lib/grammarEvidence';

const at = '2026-10-30T00:00:00.000Z';
const target = (key: string) => ({ kind: 'grammar' as const, key, label: '〜ことができる' });

describe('grammar evidence from reader taps', () => {
  it('maps spot/use calls to facets, masked to recall and shown to recognition', () => {
    const map = buildGrammarEvidence([
      { timestamp: at, action: 'target_practice', support: 'target_masked', outcome: 'needed_help', target: target(grammarFeedbackTargetKey('g1', 'spot')) },
      { timestamp: at, action: 'target_practice', support: 'explanation_hidden', outcome: 'got_it', target: target(grammarFeedbackTargetKey('g1', 'use')) },
    ]);
    expect(map.get('g1')).toEqual([
      { wordId: 'g1', facet: 'reading', kind: 'recall', at: Date.parse(at), success: false },
      { wordId: 'g1', facet: 'meaning', kind: 'recognition', at: Date.parse(at), success: true },
    ]);
  });

  it('ignores other events, unknown keys and calls with no support or outcome', () => {
    const map = buildGrammarEvidence([
      { timestamp: at, action: 'walkthrough_completed' },
      { timestamp: at, action: 'target_practice', support: 'target_masked', outcome: 'got_it', target: target('vocab:v1') },
      { timestamp: at, action: 'target_practice', outcome: 'got_it', target: target(grammarFeedbackTargetKey('g1', 'spot')) },
      { timestamp: at, action: 'target_practice', support: 'target_masked', target: target(grammarFeedbackTargetKey('g1', 'spot')) },
    ]);
    expect(map.size).toBe(0);
  });

  it('is weak after a miss and strong after a hidden success', () => {
    const now = Date.parse(at);
    const miss = buildGrammarEvidence([{ timestamp: at, action: 'target_practice', support: 'target_masked', outcome: 'needed_help', target: target(grammarFeedbackTargetKey('g', 'use')) }]).get('g')!;
    const hit = buildGrammarEvidence([{ timestamp: at, action: 'target_practice', support: 'target_masked', outcome: 'got_it', target: target(grammarFeedbackTargetKey('g', 'use')) }]).get('g')!;
    expect(grammarStrength(miss, 'use', now)).toBe(0);
    expect(grammarStrength(hit, 'use', now)).toBeGreaterThan(0.6);
    expect(grammarStrength(hit, 'spot', now)).toBe(0);
  });

  it('takes the weakest tapped facet per pattern and omits untapped patterns', () => {
    const now = Date.parse(at);
    const strengths = grammarPatternStrengths(
      [
        { timestamp: at, action: 'target_practice', support: 'target_masked', outcome: 'got_it', target: target(grammarFeedbackTargetKey('g', 'use')) },
        { timestamp: at, action: 'target_practice', support: 'target_masked', outcome: 'needed_help', target: target(grammarFeedbackTargetKey('g', 'spot')) },
        { timestamp: at, action: 'target_practice', support: 'target_masked', outcome: 'got_it', target: target(grammarFeedbackTargetKey('h', 'use')) },
      ],
      now,
    );
    expect(strengths.get('g')).toBe(0);
    expect(strengths.get('h')).toBeGreaterThan(0.6);
    expect(strengths.has('nope')).toBe(false);
  });
});
