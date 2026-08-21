import { describe, expect, it } from 'vitest';

import {
  buildKanjiumPitchIndex,
  katakanaToHiragana,
  lookupKanjiumPitch,
  parseYomitanPitchRow,
} from '../scripts/lib/kanjiumPitch';

describe('katakanaToHiragana', () => {
  it('converts katakana to hiragana', () => {
    expect(katakanaToHiragana('アメ')).toBe('あめ');
  });

  it('leaves the long-vowel mark and non-katakana characters unchanged', () => {
    expect(katakanaToHiragana('コーヒー')).toBe('こーひー');
    expect(katakanaToHiragana('あめ')).toBe('あめ');
  });
});

describe('parseYomitanPitchRow', () => {
  it('parses a real Kanjium-shaped row', () => {
    expect(parseYomitanPitchRow(['雨', 'pitch', { reading: 'アメ', pitches: [{ position: 1 }] }])).toEqual({
      term: '雨',
      reading: 'アメ',
      positions: [1],
    });
  });

  it('collects multiple accepted positions from one row', () => {
    expect(
      parseYomitanPitchRow(['端', 'pitch', { reading: 'ハシ', pitches: [{ position: 0 }, { position: 1 }] }]),
    ).toEqual({ term: '端', reading: 'ハシ', positions: [0, 1] });
  });

  it('rejects rows that are not a pitch meta type', () => {
    expect(parseYomitanPitchRow(['雨', 'freq', { value: 100 }])).toBeNull();
  });

  it('rejects malformed rows', () => {
    expect(parseYomitanPitchRow(['雨', 'pitch'])).toBeNull();
    expect(parseYomitanPitchRow(['雨', 'pitch', { reading: 'アメ' }])).toBeNull();
    expect(parseYomitanPitchRow(['雨', 'pitch', { reading: 'アメ', pitches: [] }])).toBeNull();
    expect(parseYomitanPitchRow(null)).toBeNull();
  });
});

describe('buildKanjiumPitchIndex / lookupKanjiumPitch', () => {
  const rows: unknown[] = [
    ['雨', 'pitch', { reading: 'アメ', pitches: [{ position: 1 }] }],
    ['飴', 'pitch', { reading: 'アメ', pitches: [{ position: 0 }] }],
    ['橋', 'pitch', { reading: 'ハシ', pitches: [{ position: 2 }] }],
    ['橋', 'pitch', { reading: 'ハシ', pitches: [{ position: 3 }] }],
    ['freq-only', 'freq', { value: 1 }],
  ];
  const index = buildKanjiumPitchIndex(rows);

  it('keeps homophones distinct by expression+reading (rain vs. candy)', () => {
    expect(lookupKanjiumPitch(index, '雨', 'あめ')).toEqual([1]);
    expect(lookupKanjiumPitch(index, '飴', 'あめ')).toEqual([0]);
  });

  it('normalizes the query reading (hiragana or katakana) the same as the index', () => {
    expect(lookupKanjiumPitch(index, '雨', 'アメ')).toEqual([1]);
  });

  it('merges positions across repeated rows for the same key, without duplicating', () => {
    expect(lookupKanjiumPitch(index, '橋', 'はし')).toEqual([2, 3]);
  });

  it('returns null for unknown expression+reading pairs', () => {
    expect(lookupKanjiumPitch(index, '存在しない', 'そんざいしない')).toBeNull();
  });
});
