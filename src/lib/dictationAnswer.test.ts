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

  it('accepts a romaji answer against the kana reading', () => {
    const grade = gradeDictation('kinou, tomodachi to eiga wo mini ikimashita.', JP, KANA);
    expect(grade.correct).toBe(true);
    expect(grade.gradedAgainst).toBe(KANA);
  });

  it('diffs a wrong romaji answer as kana', () => {
    const grade = gradeDictation('kinou tomodachi to eiga wo mi ni kimashita', JP, KANA);
    expect(grade.correct).toBe(false);
    expect(grade.typedSegments.map((s) => s.text).join('')).toContain('きました');
  });

  it('does not convert mixed latin/kana garbage', () => {
    expect(gradeDictation('kinou q とも', JP, KANA).correct).toBe(false);
  });

  describe('digits in the stored reading', () => {
    const JP2 = '1月の気温は札幌はマイナス5度くらいです。';
    const KANA2 = '1がつのきおんはさっぽろはマイナス5どくらいです。';

    it('accepts the spelled-out reading and katakana loanwords', () => {
      expect(
        gradeDictation('いちがつのきおんはさっぽろはまいなすごどくらいです', JP2, KANA2).correct,
      ).toBe(true);
    });

    it('only flags the real typos in the diff', () => {
      const grade = gradeDictation('いちがつのきょんはさっぱろはまいなすごどくらいです', JP2, KANA2);
      expect(grade.correct).toBe(false);
      expect(grade.typedSegments.filter((s) => !s.matched).map((s) => s.text)).toEqual(['ょ', 'ぱ']);
    });
  });
});
