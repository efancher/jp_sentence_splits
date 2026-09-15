import { describe, expect, it } from 'vitest';

import {
  blankPatternInSentence,
  computeGrammarLearnerState,
  computeGrammarPriorityBucket,
  explainGrammarPriority,
  normalizeGrammarPatternKey,
} from '../src/lib/grammarPatterns';

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

describe('computeGrammarLearnerState', () => {
  it('is encountered with no confirmed encounters', () => {
    expect(
      computeGrammarLearnerState({
        confirmedCount: 0,
        distinctSourceCount: 1,
      }),
    ).toBe('encountered');
  });

  it('is noticed once confirmed in a single source', () => {
    expect(
      computeGrammarLearnerState({
        confirmedCount: 1,
        distinctSourceCount: 1,
      }),
    ).toBe('noticed');
  });

  it('is recognized once confirmed across 2+ distinct sources', () => {
    expect(
      computeGrammarLearnerState({
        confirmedCount: 2,
        distinctSourceCount: 2,
      }),
    ).toBe('recognized');
  });

  it('stays noticed (not recognized) with only one source, however many confirmations', () => {
    expect(
      computeGrammarLearnerState({
        confirmedCount: 3,
        distinctSourceCount: 1,
      }),
    ).toBe('noticed');
  });
});

describe('computeGrammarPriorityBucket', () => {
  it('is strong when recognized', () => {
    expect(
      computeGrammarPriorityBucket({
        encounterCount: 10,
        confirmedCount: 3,
        distinctSourceCount: 3,
        state: 'recognized',
      }),
    ).toBe('strong');
  });

  it('is developing when confirmed but not yet recognized', () => {
    expect(
      computeGrammarPriorityBucket({
        encounterCount: 10,
        confirmedCount: 1,
        distinctSourceCount: 1,
        state: 'noticed',
      }),
    ).toBe('developing');
  });

  it('is worth_learning_now when unconfirmed but encountered 3+ times', () => {
    expect(
      computeGrammarPriorityBucket({
        encounterCount: 3,
        confirmedCount: 0,
        distinctSourceCount: 3,
        state: 'encountered',
      }),
    ).toBe('worth_learning_now');
  });

  it('is recently_encountered when unconfirmed and encountered fewer than 3 times', () => {
    expect(
      computeGrammarPriorityBucket({
        encounterCount: 1,
        confirmedCount: 0,
        distinctSourceCount: 1,
        state: 'encountered',
      }),
    ).toBe('recently_encountered');
  });
});

describe('explainGrammarPriority', () => {
  it('mentions encounter count, source diversity, and unconfirmed status', () => {
    const text = explainGrammarPriority({
      encounterCount: 3,
      confirmedCount: 0,
      distinctSourceCount: 2,
      state: 'encountered',
    });
    expect(text).toContain('Encountered 3 times');
    expect(text).toContain('across 2 sources');
    expect(text).toContain('not confirmed yet');
  });

  it('mentions confirmed status for a confirmed pattern', () => {
    const text = explainGrammarPriority({
      encounterCount: 8,
      confirmedCount: 2,
      distinctSourceCount: 1,
      state: 'noticed',
    });
    expect(text).toContain('confirmed noticing it');
  });

  it('uses singular phrasing for a single encounter', () => {
    const text = explainGrammarPriority({
      encounterCount: 1,
      confirmedCount: 1,
      distinctSourceCount: 1,
      state: 'noticed',
    });
    expect(text).toContain('Encountered 1 time,');
  });
});
