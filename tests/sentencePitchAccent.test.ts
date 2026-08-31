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
