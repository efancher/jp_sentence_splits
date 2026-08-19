import { describe, expect, it } from 'vitest';

import { normalizeGrammarPatternKey } from '../src/lib/grammarPatterns';

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
