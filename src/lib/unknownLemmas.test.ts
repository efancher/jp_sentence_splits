import { describe, expect, it } from 'vitest';

import {
  buildKnownLemmaSet,
  LEMMA_WEIGHT,
  lemmaKey,
  lemmaWeight,
  scoreSentence,
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

describe('scoreSentence', () => {
  const known = buildKnownLemmaSet([[tok('雨', 'あめ')]]);

  it('scores a tokenized sentence by its unknown content lemmas', () => {
    expect(scoreSentence([tok('雨', 'あめ'), tok('止む', 'やむ')], known)).toEqual({
      scorable: true,
      unknown: [lemmaKey('止む', 'やむ')],
      total: 2,
    });
  });

  it('treats an untokenized sentence as not scorable rather than zero unknowns', () => {
    expect(scoreSentence([], known)).toEqual({ scorable: false, reason: 'no-tokens' });
    expect(scoreSentence(undefined, known)).toEqual({ scorable: false, reason: 'no-tokens' });
  });

  it('treats a sentence with only function words as not scorable', () => {
    expect(scoreSentence([tok('は', 'は', false)], known)).toEqual({ scorable: false, reason: 'no-content-words' });
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

describe('lemmaWeight', () => {
  it('down-weights interjections, fillers, discourse markers and proper nouns', () => {
    expect(lemmaWeight('うん', '感動詞/一般')).toBe(LEMMA_WEIGHT.filler);
    expect(lemmaWeight('あの', '感動詞/フィラー')).toBe(LEMMA_WEIGHT.filler);
    expect(lemmaWeight('まあ', '副詞')).toBe(LEMMA_WEIGHT.filler);
    expect(lemmaWeight('あの', '連体詞')).toBe(LEMMA_WEIGHT.filler);
    expect(lemmaWeight('東京', '名詞/固有名詞')).toBe(LEMMA_WEIGHT.properNoun);
  });

  it('down-weights a verb that only exists inside a grammar pattern (かもしれない)', () => {
    expect(lemmaWeight('しれる', '動詞/一般')).toBe(LEMMA_WEIGHT.grammarBound);
    expect(lemmaWeight('知る', '動詞/一般')).toBe(LEMMA_WEIGHT.normal);
    expect(lemmaWeight('いける', '動詞/非自立可能')).toBe(LEMMA_WEIGHT.grammarBound);
    expect(lemmaWeight('ござる', '動詞/非自立可能')).toBe(LEMMA_WEIGHT.grammarBound);
  });

  it('binds つく only as the について verb, not 気がつく / 嘘をつく', () => {
    expect(lemmaWeight('つく', '動詞/一般')).toBe(LEMMA_WEIGHT.grammarBound);
    expect(lemmaWeight('つく', '動詞/非自立可能')).toBe(LEMMA_WEIGHT.normal);
    expect(lemmaWeight('つく', undefined)).toBe(LEMMA_WEIGHT.normal);
  });

  it('leaves frequent real words alone, whatever their tag', () => {
    expect(lemmaWeight('ちょっと', '副詞')).toBe(LEMMA_WEIGHT.normal);
    expect(lemmaWeight('やる', '動詞/非自立可能')).toBe(LEMMA_WEIGHT.normal);
    expect(lemmaWeight('学校', '名詞/普通名詞')).toBe(LEMMA_WEIGHT.normal);
    expect(lemmaWeight('学校', undefined)).toBe(LEMMA_WEIGHT.normal);
  });
});

describe('unlockValueByLemma weighting', () => {
  it('scales each lemma share by its weight', () => {
    const value = unlockValueByLemma([['a'], ['a', 'b']], 2, (key) => (key === 'a' ? 0.5 : 1));
    expect(value.get('a')).toBeCloseTo(0.5 + 0.25);
    expect(value.get('b')).toBeCloseTo(0.5);
  });
});

describe('unknownCountHistogram', () => {
  it('pools counts at or above the cap into the last bucket', () => {
    expect(unknownCountHistogram([0, 1, 1, 3, 9, 20], 3)).toEqual([1, 2, 0, 3]);
  });
});
