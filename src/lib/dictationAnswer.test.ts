import { describe, expect, it } from 'vitest';

import { gradeDictation } from './dictationAnswer';

const JP = '昨日、友達と映画を見に行きました。';
const KANA = 'きのう、ともだちとえいがをみにいきました。';

describe('gradeDictation', () => {
  it('accepts the exact written sentence, ignoring punctuation and spaces', () => {
    expect(gradeDictation('昨日 友達と映画を見に行きました', JP, KANA).correct).toBe(true);
  });

  it('accepts the kana reading when the learner cannot write the kanji', () => {
    const grade = gradeDictation('きのう ともだちと えいがを みにいきました', JP, KANA);
    expect(grade.correct).toBe(true);
    expect(grade.gradedAgainst).toBe(KANA);
  });

  it('treats katakana and hiragana as equal', () => {
    expect(gradeDictation('キノウ、トモダチトエイガヲミニイキマシタ。', JP, KANA).correct).toBe(true);
  });

  it('rejects a wrong answer and marks the missed characters', () => {
    const grade = gradeDictation('昨日友達と映画を見に来ました', JP, KANA);
    expect(grade.correct).toBe(false);
    expect(grade.gradedAgainst).toBe(JP);
    expect(grade.expectedSegments.filter((s) => !s.matched).map((s) => s.text)).toEqual(['行き']);
    expect(grade.typedSegments.filter((s) => !s.matched).map((s) => s.text)).toEqual(['来']);
  });

  it('rejects a blank answer', () => {
    expect(gradeDictation('  ', JP, KANA).correct).toBe(false);
  });

  it('works without a reading', () => {
    expect(gradeDictation('こんにちは', 'こんにちは。').correct).toBe(true);
  });
});
