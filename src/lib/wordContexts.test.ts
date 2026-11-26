import { describe, expect, it } from 'vitest';

import { pickOtherContexts, type ContextCandidate } from './wordContexts';
import type { LemmaSource } from './unknownLemmas';

const tok = (expression: string, selectedByDefault = true): LemmaSource => ({ expression, reading: expression, selectedByDefault });
const sentence = (sentenceId: string, japanese: string, words: string[]): ContextCandidate => ({
  sentenceId,
  japanese,
  translation: `t-${sentenceId}`,
  suggestions: words.map((word) => tok(word)),
});

describe('pickOtherContexts', () => {
  const current = sentence('a', '今日のトピックは習慣です。', ['今日', 'トピック', '習慣']);

  it('skips the current sentence and repeats of it, and keeps distinct contexts', () => {
    const picked = pickOtherContexts('習慣', current, [
      current,
      sentence('b', '今日のトピックは習慣です', ['今日', 'トピック', '習慣']),
      sentence('c', '毎朝走る習慣がある。', ['毎朝', '走る', '習慣']),
      sentence('d', '習慣を変える。', ['習慣', '変える']),
      sentence('e', '悪い習慣をやめたい。', ['悪い', '習慣', 'やめる']),
    ]);
    expect(picked.map((item) => item.sentenceId)).toEqual(['d', 'c']);
  });

  it('does not offer the same line twice and ignores sentences without the word', () => {
    const picked = pickOtherContexts('習慣', current, [
      sentence('b', '早起きが習慣だ。', ['早起き', '習慣']),
      sentence('c', '早起きが習慣だ！', ['早起き', '習慣']),
      sentence('d', '猫が好き。', ['猫', '好き']),
    ]);
    expect(picked.map((item) => item.sentenceId)).toEqual(['b']);
  });

  it('returns nothing when no other context exists', () => {
    expect(pickOtherContexts('習慣', current, [current])).toEqual([]);
  });
});
