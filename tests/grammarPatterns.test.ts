import { describe, expect, it } from 'vitest';

import type { GrammarPattern } from '../src/domain/types';
import {
  blankPatternInSentence,
  buildGrammarCompletionChoices,
  normalizeGrammarPatternKey,
} from '../src/lib/grammarPatterns';

function stubPattern(id: string, canonicalName: string): GrammarPattern {
  const now = new Date().toISOString();
  return {
    id,
    canonicalName,
    normalizedKey: normalizeGrammarPatternKey(canonicalName),
    aliases: [],
    shortMeaning: '',
    provenance: 'manual',
    createdAt: now,
    updatedAt: now,
  };
}

describe('normalizeGrammarPatternKey', () => {
  it('strips a leading full-width wave dash', () => {
    expect(normalizeGrammarPatternKey('〜わけがない')).toBe('わけがない');
  });

  it('strips a leading full-width tilde', () => {
    expect(normalizeGrammarPatternKey('～わけがない')).toBe('わけがない');
  });

  it('strips a leading ASCII tilde and surrounding whitespace', () => {
    expect(normalizeGrammarPatternKey('  ~わけがない  ')).toBe('わけがない');
  });

  it('is a no-op for a name with no leading/trailing marker', () => {
    expect(normalizeGrammarPatternKey('わけがない')).toBe('わけがない');
  });

  it('preserves an internal wave dash marking a real gap in the pattern', () => {
    expect(normalizeGrammarPatternKey('しか〜ない')).toBe('しか〜ない');
  });

  it('NFC-normalizes a decomposed base+combining-mark character to match its precomposed form', () => {
    // か (U+304B) + combining voiced sound mark (U+3099), decomposed, vs.
    // the single precomposed が (U+304C) — built from \u escapes so the two
    // inputs are guaranteed genuinely different code-unit sequences.
    const decomposed = 'が' + 'けがない';
    const precomposed = 'が' + 'けがない';
    expect(decomposed).not.toBe(precomposed); // sanity: genuinely different strings going in
    expect(normalizeGrammarPatternKey(decomposed)).toBe(
      normalizeGrammarPatternKey(precomposed),
    );
  });
});

describe('blankPatternInSentence', () => {
  it('blanks the first verbatim occurrence, tilde-stripped', () => {
    expect(blankPatternInSentence('しかたないでしょう。', '〜しかたない')).toEqual({
      before: '',
      match: 'しかたない',
      after: 'でしょう。',
    });
  });

  it('returns null when the canonical name does not appear verbatim (e.g. a colloquial variant)', () => {
    // わけない, not わけがない — the が is dropped, a common colloquial variant.
    expect(blankPatternInSentence('そんなこと言うわけないでしょ。', '〜わけがない')).toBeNull();
  });

  it('returns null for an empty (fully tilde/whitespace) name', () => {
    expect(blankPatternInSentence('何か。', '〜')).toBeNull();
  });
});

describe('buildGrammarCompletionChoices', () => {
  it('includes the correct pattern plus up to 3 distractors', () => {
    const correct = stubPattern('p-correct', '〜わけがない');
    const others = [
      stubPattern('p-1', '〜はずがない'),
      stubPattern('p-2', '〜てしまう'),
      stubPattern('p-3', '〜ながら'),
      stubPattern('p-4', '〜ば'),
      stubPattern('p-5', '〜たら'),
    ];
    const choices = buildGrammarCompletionChoices(correct, others);
    expect(choices).toHaveLength(4);
    expect(choices.map((c) => c.id)).toContain('p-correct');
    // No duplicates, and every choice is either the correct one or a real distractor.
    expect(new Set(choices.map((c) => c.id)).size).toBe(4);
  });

  it('returns just the correct pattern when no other patterns exist', () => {
    const correct = stubPattern('p-correct', '〜わけがない');
    expect(buildGrammarCompletionChoices(correct, [])).toEqual([correct]);
  });

  it('is deterministic across calls for the same pattern id and pool', () => {
    const correct = stubPattern('p-correct', '〜わけがない');
    const others = [
      stubPattern('p-1', '〜はずがない'),
      stubPattern('p-2', '〜てしまう'),
      stubPattern('p-3', '〜ながら'),
    ];
    const first = buildGrammarCompletionChoices(correct, others).map((c) => c.id);
    const second = buildGrammarCompletionChoices(correct, others).map((c) => c.id);
    expect(second).toEqual(first);
  });
});
