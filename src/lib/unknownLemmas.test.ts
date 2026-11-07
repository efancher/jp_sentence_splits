import { describe, expect, it } from 'vitest';

import {
  buildKnownLemmaSet,
  lemmaKey,
  sentenceContentLemmas,
  unknownCountHistogram,
  unknownLemmasForSentence,
  unlockValueByLemma,
  type LemmaSource,
} from './unknownLemmas';

const tok = (expression: string, reading: string, selectedByDefault = true): LemmaSource => ({
  expression,
  reading,
  selectedByDefault,
});

describe('sentenceContentLemmas', () => {
  it('keeps only default-checked tokens, de-duplicated, keyed by expression + reading', () => {
    expect(
      sentenceContentLemmas([tok('雨', 'あめ'), tok('は', 'は', false), tok('雨', 'あめ'), tok('降る', 'ふる')]),
    ).toEqual([lemmaKey('雨', 'あめ'), lemmaKey('降る', 'ふる')]);
  });

  it('keeps homographs with different readings apart', () => {
    expect(sentenceContentLemmas([tok('雨', 'あめ'), tok('雨', 'あま')])).toHaveLength(2);
  });

  it('tolerates a sentence with no suggestions', () => {
    expect(sentenceContentLemmas(undefined)).toEqual([]);
    expect(sentenceContentLemmas([])).toEqual([]);
  });
});

describe('known set and unknown lemmas', () => {
  const introduced = [[tok('雨', 'あめ'), tok('が', 'が', false), tok('降る', 'ふる')], undefined];

  it('builds the known set from introduced sentences plus trusted extras', () => {
    const known = buildKnownLemmaSet(introduced, [lemmaKey('傘', 'かさ')]);
    expect([...known].sort()).toEqual([lemmaKey('傘', 'かさ'), lemmaKey('雨', 'あめ'), lemmaKey('降る', 'ふる')].sort());
  });

  it('reports unknown content lemmas and ignores function words', () => {
    const known = buildKnownLemmaSet(introduced);
    const candidate = [tok('雨', 'あめ'), tok('は', 'は', false), tok('止む', 'やむ'), tok('傘', 'かさ')];
    expect(unknownLemmasForSentence(candidate, known)).toEqual([lemmaKey('止む', 'やむ'), lemmaKey('傘', 'かさ')]);
  });

  it('treats an all-known sentence as having no unknowns', () => {
    expect(unknownLemmasForSentence([tok('雨', 'あめ')], buildKnownLemmaSet(introduced))).toEqual([]);
  });
});

describe('unlockValueByLemma', () => {
  it('weights a lone unknown above a shared one and skips sentences beyond the cap', () => {
    const value = unlockValueByLemma([['a'], ['a', 'b'], ['b', 'c', 'd'], []]);
    expect(value.get('a')).toBeCloseTo(1.5);
    expect(value.get('b')).toBeCloseTo(0.5);
    expect(value.has('c')).toBe(false);
  });
});

describe('unknownCountHistogram', () => {
  it('pools counts at or above the cap into the last bucket', () => {
    expect(unknownCountHistogram([0, 1, 1, 3, 9, 20], 3)).toEqual([1, 2, 0, 3]);
  });
});
