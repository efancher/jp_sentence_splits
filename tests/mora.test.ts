import { describe, expect, it } from 'vitest';

import { getSentenceReadingForMora, segmentIntoMorae } from '../src/lib/mora';

function texts(units: ReturnType<typeof segmentIntoMorae>): string[] {
  return units.map((unit) => unit.text);
}

describe('segmentIntoMorae', () => {
  it('splits ちょっと into ちょ | っ | と', () => {
    const units = segmentIntoMorae('ちょっと');
    expect(texts(units)).toEqual(['ちょ', 'っ', 'と']);
    expect(units.map((u) => u.kind)).toEqual(['normal', 'sokuon', 'normal']);
  });

  it('splits がっこう into が | っ | こ | う', () => {
    expect(texts(segmentIntoMorae('がっこう'))).toEqual(['が', 'っ', 'こ', 'う']);
  });

  it('splits きょう into きょ | う', () => {
    expect(texts(segmentIntoMorae('きょう'))).toEqual(['きょ', 'う']);
  });

  it('treats ん as its own mora', () => {
    const units = segmentIntoMorae('こんにちは');
    expect(texts(units)).toEqual(['こ', 'ん', 'に', 'ち', 'は']);
    expect(units[1]!.kind).toBe('moraic-n');
  });

  it('treats a long-vowel mark as its own mora', () => {
    const units = segmentIntoMorae('ラーメン');
    expect(texts(units)).toEqual(['ラ', 'ー', 'メ', 'ン']);
    expect(units[1]!.kind).toBe('long-vowel-mark');
    expect(units[3]!.kind).toBe('moraic-n');
  });

  it('merges small vowel kana in katakana loanwords', () => {
    expect(texts(segmentIntoMorae('ファイル'))).toEqual(['ファ', 'イ', 'ル']);
    expect(texts(segmentIntoMorae('ティッシュ'))).toEqual(['ティ', 'ッ', 'シュ']);
  });

  it('skips punctuation and non-kana characters', () => {
    expect(texts(segmentIntoMorae('こんにちは、げんきですか？'))).toEqual([
      'こ', 'ん', 'に', 'ち', 'は', 'げ', 'ん', 'き', 'で', 'す', 'か',
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(segmentIntoMorae('')).toEqual([]);
  });

  it('assigns index sequentially across chunks and carries wordIndex', () => {
    const units = segmentIntoMorae([
      { text: 'きょう', wordIndex: 0 },
      { text: 'は', wordIndex: 1 },
    ]);
    expect(units.map((u) => u.index)).toEqual([0, 1, 2]);
    expect(units.map((u) => u.wordIndex)).toEqual([0, 0, 1]);
  });
});

describe('getSentenceReadingForMora', () => {
  it('prefers inlineReading and preserves word boundaries', () => {
    const chunks = getSentenceReadingForMora({
      inlineReading: '今日[きょう]は ちょっと 寒[さむ]いです。',
      readingOnly: '',
    });
    expect(chunks).not.toBeNull();
    const units = segmentIntoMorae(chunks!);
    expect(texts(units)).toEqual([
      'きょ', 'う', 'は', 'ちょ', 'っ', 'と', 'さ', 'む', 'い', 'で', 'す',
    ]);
  });

  it('falls back to readingOnly when inlineReading has no bracket markup', () => {
    const chunks = getSentenceReadingForMora({
      inlineReading: '今日はちょっと寒いです',
      readingOnly: 'きょうはちょっとさむいです',
    });
    expect(chunks).toEqual([{ text: 'きょうはちょっとさむいです' }]);
  });

  it('falls back to readingOnly when inlineReading is empty', () => {
    const chunks = getSentenceReadingForMora({
      inlineReading: '',
      readingOnly: 'きょうはちょっとさむいです',
    });
    expect(chunks).toEqual([{ text: 'きょうはちょっとさむいです' }]);
  });

  it('returns null when neither reading is available', () => {
    expect(getSentenceReadingForMora({ inlineReading: '', readingOnly: '' })).toBeNull();
  });
});
