import { describe, expect, it } from 'vitest';

import { buildSentencePitchAccents } from '../src/lib/sentencePitchAccent';

describe('buildSentencePitchAccents', () => {
  it('produces a per-mora h/l contour and pattern for each accented word', () => {
    const words = buildSentencePitchAccents('先生を見つける', [
      { surfaceForm: '先生', reading: 'せんせい', pitchAccentPositions: [3] },
      { surfaceForm: '見つける', reading: 'みつける', pitchAccentPositions: [0] },
    ]);
    expect(words).toHaveLength(2);
    expect(words[0]).toMatchObject({
      surfaceForm: '先生',
      morae: ['せ', 'ん', 'せ', 'い'],
      classes: ['l', 'h', 'h', 'l'],
      pattern: 'nakadaka',
      particleHigh: false,
      start: 0,
    });
    expect(words[1]).toMatchObject({
      surfaceForm: '見つける',
      classes: ['l', 'h', 'h', 'h'],
      pattern: 'heiban',
      particleHigh: true,
      start: 3,
    });
  });

  it('attaches trailing grammatical particles to the word at the particleHigh level', () => {
    const words = buildSentencePitchAccents('先生が本を読む', [
      { surfaceForm: '先生', reading: 'せんせい', pitchAccentPositions: [3] },
      { surfaceForm: '本', reading: 'ほん', pitchAccentPositions: [0] },
    ]);
    // 先生 is accented (nakadaka) → its が drops to low.
    expect(words[0]).toMatchObject({ surfaceForm: '先生', particleHigh: false, particleTail: ['が'] });
    // 本 is heiban → its を stays high.
    expect(words[1]).toMatchObject({ surfaceForm: '本', particleHigh: true, particleTail: ['を'] });
  });

  it('stops the particle tail at okurigana, kanji, or the next marked word', () => {
    const [word] = buildSentencePitchAccents('本には', [
      { surfaceForm: '本', reading: 'ほん', pitchAccentPositions: [0] },
    ]);
    expect(word!.particleTail).toEqual(['に', 'は']);

    const [copula] = buildSentencePitchAccents('本だった', [
      { surfaceForm: '本', reading: 'ほん', pitchAccentPositions: [0] },
    ]);
    // だ is copula okurigana, not a clitic particle — tail stops immediately.
    expect(copula!.particleTail).toEqual([]);

    const noTail = buildSentencePitchAccents('本読む', [
      { surfaceForm: '本', reading: 'ほん', pitchAccentPositions: [0] },
      { surfaceForm: '読む', reading: 'よむ', pitchAccentPositions: [1] },
    ]);
    expect(noTail[0]!.particleTail).toEqual([]);
  });

  it('skips words with no accent data', () => {
    const words = buildSentencePitchAccents('本を読む', [
      { surfaceForm: '本', reading: 'ほん', pitchAccentPositions: [] },
      { surfaceForm: '読む', reading: 'よむ' },
    ]);
    expect(words).toEqual([]);
  });

  it('orders words by their position in the sentence and handles repeats', () => {
    const words = buildSentencePitchAccents('雨、また雨', [
      { surfaceForm: '雨', reading: 'あめ', pitchAccentPositions: [1] },
      { surfaceForm: '雨', reading: 'あめ', pitchAccentPositions: [1] },
    ]);
    expect(words.map((w) => w.start)).toEqual([0, 4]);
  });

  it('sorts an unlocatable surface form to the end rather than dropping it', () => {
    const words = buildSentencePitchAccents('見つける', [
      { surfaceForm: '先生', reading: 'せんせい', pitchAccentPositions: [3] },
      { surfaceForm: '見つける', reading: 'みつける', pitchAccentPositions: [0] },
    ]);
    expect(words.map((w) => w.surfaceForm)).toEqual(['見つける', '先生']);
    expect(words[1]!.start).toBe(-1);
  });
});
