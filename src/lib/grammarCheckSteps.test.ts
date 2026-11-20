import { describe, expect, it } from 'vitest';
import { dueGrammarChecks, type GrammarCheckSentence } from './grammarCheckSteps';

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 20);

function sentence(id: string, over: Partial<GrammarCheckSentence> = {}): GrammarCheckSentence {
  return { sentenceId: id, lastWalkedAt: now - 5 * DAY, patterns: [{ patternId: `p-${id}`, name: `N-${id}` }], ...over };
}

describe('dueGrammarChecks', () => {
  it('offers an unchecked pattern on a sentence walked a day or more ago', () => {
    expect(dueGrammarChecks({ sentences: [sentence('a')], now }).map((d) => d.sentenceId)).toEqual(['a']);
  });

  it('waits a day after the walkthrough', () => {
    expect(dueGrammarChecks({ sentences: [sentence('a', { lastWalkedAt: now - DAY / 2 })], now })).toEqual([]);
  });

  it('skips solid patterns and spaces recent checks', () => {
    const solid = sentence('a', { patterns: [{ patternId: 'p', name: 'P', strength: 0.9 }] });
    const clean = sentence('b', { patterns: [{ patternId: 'q', name: 'Q', strength: 0.3, lastCheck: { at: now - 3 * DAY, gotIt: true } }] });
    const missed = sentence('c', { patterns: [{ patternId: 'r', name: 'R', strength: 0.3, lastCheck: { at: now - 3 * DAY, gotIt: false } }] });
    expect(dueGrammarChecks({ sentences: [solid, clean, missed], now }).map((d) => d.sentenceId)).toEqual(['c']);
  });

  it('ranks shaky patterns ahead of unchecked ones and picks the pattern the panel would', () => {
    const unchecked = sentence('u');
    const shaky = sentence('s', {
      patterns: [
        { patternId: 'x', name: 'X', strength: 0.4 },
        { patternId: 'y', name: 'Y', strength: 0.2 },
      ],
    });
    const due = dueGrammarChecks({ sentences: [unchecked, shaky], now });
    expect(due.map((d) => d.sentenceId)).toEqual(['s', 'u']);
    expect(due[0].patternId).toBe('y');
  });

  it('offers a pattern once even when several sentences carry it', () => {
    const a = sentence('a', { patterns: [{ patternId: 'same', name: 'S' }] });
    const b = sentence('b', { patterns: [{ patternId: 'same', name: 'S' }] });
    expect(dueGrammarChecks({ sentences: [a, b], now })).toHaveLength(1);
  });
});
