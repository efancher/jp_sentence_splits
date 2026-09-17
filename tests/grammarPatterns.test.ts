import { describe, expect, it } from 'vitest';

import {
  blankPatternInSentence,
  computeGrammarLearnerState,
  computeGrammarPriorityBucket,
  explainGrammarPriority,
  isGrammarPatternAnswerCorrect,
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

describe('isGrammarPatternAnswerCorrect', () => {
  it('accepts an exact match', () => {
    expect(isGrammarPatternAnswerCorrect('〜わけがない', '〜わけがない')).toBe(true);
  });

  it('is insensitive to a leading tilde on either side', () => {
    expect(isGrammarPatternAnswerCorrect('わけがない', '〜わけがない')).toBe(true);
    expect(isGrammarPatternAnswerCorrect('〜わけがない', 'わけがない')).toBe(true);
  });

  it('ignores a parenthetical sense-gloss on the canonical name', () => {
    expect(isGrammarPatternAnswerCorrect('ている', '〜ている（動作進行）')).toBe(true);
  });

  it('ignores incidental whitespace', () => {
    expect(isGrammarPatternAnswerCorrect('  わけ が ない  ', '〜わけがない')).toBe(true);
  });

  it('rejects a genuinely different construction', () => {
    expect(isGrammarPatternAnswerCorrect('〜はずがない', '〜わけがない')).toBe(false);
  });

  it('rejects a blank answer', () => {
    expect(isGrammarPatternAnswerCorrect('', '〜わけがない')).toBe(false);
    expect(isGrammarPatternAnswerCorrect('   ', '〜わけがない')).toBe(false);
  });
});

describe('computeGrammarLearnerState', () => {
  it('is encountered with no confirmed encounters', () => {
    expect(
      computeGrammarLearnerState({
        encounterCount: 1,
        confirmedCount: 0,
        tracked: false,
        proficient: false,
      }),
    ).toBe('encountered');
  });

  it('is noticed once the learner has confirmed at least one encounter', () => {
    expect(
      computeGrammarLearnerState({
        encounterCount: 2,
        confirmedCount: 1,
        tracked: false,
        proficient: false,
      }),
    ).toBe('noticed');
  });

  it('is recognized once tracked and FSRS-proficient, regardless of confirmed count', () => {
    expect(
      computeGrammarLearnerState({
        encounterCount: 5,
        confirmedCount: 0,
        tracked: true,
        proficient: true,
      }),
    ).toBe('recognized');
  });

  it('stays noticed when tracked but not yet proficient', () => {
    expect(
      computeGrammarLearnerState({
        encounterCount: 5,
        confirmedCount: 1,
        tracked: true,
        proficient: false,
      }),
    ).toBe('noticed');
  });

});

describe('computeGrammarPriorityBucket', () => {
  it('is strong when recognized with no recent again ratings', () => {
    expect(
      computeGrammarPriorityBucket({
        encounterCount: 10,
        tracked: true,
        state: 'recognized',
        recentAgainCount: 0,
        recentReviewCount: 5,
      }),
    ).toBe('strong');
  });

  it('is developing when tracked but not yet strong', () => {
    expect(
      computeGrammarPriorityBucket({
        encounterCount: 10,
        tracked: true,
        state: 'noticed',
        recentAgainCount: 2,
        recentReviewCount: 5,
      }),
    ).toBe('developing');
  });

  it('is worth_learning_now when untracked but encountered 3+ times', () => {
    expect(
      computeGrammarPriorityBucket({
        encounterCount: 3,
        tracked: false,
        state: 'encountered',
        recentAgainCount: 0,
        recentReviewCount: 0,
      }),
    ).toBe('worth_learning_now');
  });

  it('is recently_encountered when untracked and encountered fewer than 3 times', () => {
    expect(
      computeGrammarPriorityBucket({
        encounterCount: 1,
        tracked: false,
        state: 'encountered',
        recentAgainCount: 0,
        recentReviewCount: 0,
      }),
    ).toBe('recently_encountered');
  });

  it('recognized but still struggling recently is not strong', () => {
    expect(
      computeGrammarPriorityBucket({
        encounterCount: 10,
        tracked: true,
        state: 'recognized',
        recentAgainCount: 1,
        recentReviewCount: 5,
      }),
    ).toBe('developing');
  });

});

describe('explainGrammarPriority', () => {
  it('mentions encounter count, source diversity, and untracked status', () => {
    const text = explainGrammarPriority({
      encounterCount: 3,
      tracked: false,
      state: 'encountered',
      recentAgainCount: 0,
      recentReviewCount: 0,
      distinctSourceCount: 2,
    });
    expect(text).toContain('Encountered 3 times');
    expect(text).toContain('across 2 sources');
    expect(text).toContain('not tracked yet');
  });

  it('mentions review struggle for a tracked pattern with recent reviews', () => {
    const text = explainGrammarPriority({
      encounterCount: 8,
      tracked: true,
      state: 'noticed',
      recentAgainCount: 2,
      recentReviewCount: 5,
      distinctSourceCount: 1,
    });
    expect(text).toContain('needed help on 2 of the last 5 reviews');
  });

  it('uses singular phrasing for a single encounter and a single review', () => {
    const text = explainGrammarPriority({
      encounterCount: 1,
      tracked: true,
      state: 'noticed',
      recentAgainCount: 1,
      recentReviewCount: 1,
      distinctSourceCount: 1,
    });
    expect(text).toContain('Encountered 1 time,');
    expect(text).toContain('needed help on 1 of the last 1 review.');
  });
});
