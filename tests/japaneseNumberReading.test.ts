import { describe, expect, it } from 'vitest';

import { readCounter, readNumber, toAsciiDigits } from '../src/lib/japaneseNumberReading';

describe('readNumber', () => {
  it('reads ones, tens, and compounds', () => {
    expect(readNumber(1)).toBe('いち');
    expect(readNumber(4)).toBe('よん');
    expect(readNumber(7)).toBe('なな');
    expect(readNumber(10)).toBe('じゅう');
    expect(readNumber(11)).toBe('じゅういち');
    expect(readNumber(20)).toBe('にじゅう');
    expect(readNumber(22)).toBe('にじゅうに');
    expect(readNumber(99)).toBe('きゅうじゅうきゅう');
  });

  it('reads hundreds and thousands with the usual euphony', () => {
    expect(readNumber(100)).toBe('ひゃく');
    expect(readNumber(300)).toBe('さんびゃく');
    expect(readNumber(600)).toBe('ろっぴゃく');
    expect(readNumber(1000)).toBe('せん');
    expect(readNumber(3000)).toBe('さんぜん');
    expect(readNumber(1234)).toBe('せんにひゃくさんじゅうよん');
  });

  it('rejects out-of-range input', () => {
    expect(readNumber(-1)).toBeNull();
    expect(readNumber(10000)).toBeNull();
    expect(readNumber(1.5)).toBeNull();
  });
});

describe('toAsciiDigits', () => {
  it('normalises full-width digits', () => {
    expect(toAsciiDigits('２０歳')).toBe('20歳');
  });
});

describe('readCounter', () => {
  it('handles the irregular 人 / つ readings', () => {
    expect(readCounter(1, '人')).toBe('ひとり');
    expect(readCounter(2, '人')).toBe('ふたり');
    expect(readCounter(3, '人')).toBe('さんにん');
    expect(readCounter(4, '人')).toBe('よにん');
    expect(readCounter(1, 'つ')).toBe('ひとつ');
    expect(readCounter(2, 'つ')).toBe('ふたつ');
    expect(readCounter(8, 'つ')).toBe('やっつ');
  });

  it('fuses euphonic counters', () => {
    expect(readCounter(1, 'ヶ月')).toBe('いっかげつ');
    expect(readCounter(3, 'ヶ月')).toBe('さんかげつ');
    expect(readCounter(6, 'ヶ月')).toBe('ろっかげつ');
    expect(readCounter(1, '分')).toBe('いっぷん');
    expect(readCounter(5, '分')).toBe('ごふん');
    expect(readCounter(1, '歳')).toBe('いっさい');
    expect(readCounter(20, '歳')).toBe('はたち');
    expect(readCounter(22, '歳')).toBe('にじゅうにさい');
    expect(readCounter(10, '歳')).toBe('じゅっさい');
  });

  it('handles plain counters and aliases', () => {
    expect(readCounter(8, '番')).toBe('はちばん');
    expect(readCounter(3, '年')).toBe('さんねん');
    expect(readCounter(4, '年')).toBe('よねん');
    expect(readCounter(2, '週間')).toBe('にしゅうかん');
    expect(readCounter(1, '才')).toBe('いっさい');
    expect(readCounter(1, 'か月')).toBe('いっかげつ');
  });

  it('falls back to number + counter kana for an unknown counter', () => {
    expect(readCounter(3, '杯', 'はい')).toBe('さんはい');
    expect(readCounter(3, '杯')).toBeNull();
  });

  it('reads calendar months and days of the month', () => {
    expect(readCounter(10, '月')).toBe('じゅうがつ');
    expect(readCounter(4, '月')).toBe('しがつ');
    expect(readCounter(7, '月')).toBe('しちがつ');
    expect(readCounter(9, '月')).toBe('くがつ');
    expect(readCounter(1, '日')).toBe('ついたち');
    expect(readCounter(2, '日')).toBe('ふつか');
    expect(readCounter(4, '日')).toBe('よっか');
    expect(readCounter(14, '日')).toBe('じゅうよっか');
    expect(readCounter(20, '日')).toBe('はつか');
    expect(readCounter(24, '日')).toBe('にじゅうよっか');
    expect(readCounter(30, '日')).toBe('さんじゅうにち');
  });

  it('reads common object counters with their euphonic changes', () => {
    expect(readCounter(1, '本')).toBe('いっぽん');
    expect(readCounter(3, '本')).toBe('さんぼん');
    expect(readCounter(2, '匹')).toBe('にひき');
    expect(readCounter(3, '匹')).toBe('さんびき');
    expect(readCounter(1, '回')).toBe('いっかい');
    expect(readCounter(1, '個')).toBe('いっこ');
    expect(readCounter(5, '枚')).toBe('ごまい');
    expect(readCounter(1, '冊')).toBe('いっさつ');
    expect(readCounter(3, '台')).toBe('さんだい');
    expect(readCounter(9, '円')).toBe('きゅうえん');
    expect(readCounter(4, '時')).toBe('よじ');
    expect(readCounter(4, '時間')).toBe('よじかん');
    expect(readCounter(3, '軒')).toBe('さんげん');
  });
});
