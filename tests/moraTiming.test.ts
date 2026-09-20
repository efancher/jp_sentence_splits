import { describe, expect, it } from 'vitest';

import type { PhoneAlignment, WordAlignment } from '../src/domain/types';
import { isolatedWordRange, isolatedWordSpans } from '../src/lib/isolatedWordRange';
import { buildMoraMap, phonesToMoraIntervals, resolveMoraRange } from '../src/lib/moraTiming';

/** Phones from "label(durationMs)" pairs laid end to end from `startMs`. */
function phones(spec: string, startMs = 0): PhoneAlignment[] {
  let t = startMs;
  return spec.split(' ').map((item) => {
    const [, label, ms] = /^(.+)\((\d+)\)$/.exec(item)!;
    const start = t / 1000;
    t += Number(ms);
    return { text: label!, start, end: t / 1000 };
  });
}
const ms = (intervals: { start: number; end: number }[] | null) =>
  intervals?.map((i) => [Math.round(i.start * 1000), Math.round(i.end * 1000)]);

// Phone sequences below are real MFA output from our reference_alignment cache.
describe('phonesToMoraIntervals', () => {
  it('splits a plain word into one mora per vowel, onsets attached (生まれた)', () => {
    expect(ms(phonesToMoraIntervals(phones('ɯ(100) m(100) a(100) ɾ(40) e(80) t(90) a(100)')))).toEqual([
      [0, 100], // う
      [100, 300], // ま
      [300, 420], // れ
      [420, 610], // た
    ]);
  });

  it('treats a geminate consonant as っ plus the next onset (思っちゃう)', () => {
    expect(ms(phonesToMoraIntervals(phones('o(70) m(90) o(80) tɕː(80) a(60) ɯ(70)')))).toEqual([
      [0, 70], // お
      [70, 240], // も
      [240, 280], // っ (first half of the geminate)
      [280, 380], // ちゃ (second half + a)
      [380, 450], // う
    ]);
  });

  it('gives a long vowel two morae and a final ん its own (ラーメン)', () => {
    expect(ms(phonesToMoraIntervals(phones('ɾ(50) aː(290) m(90) e(140) ɴ(200)')))).toEqual([
      [0, 195], // ら
      [195, 340], // ー
      [340, 570], // め
      [570, 770], // ん
    ]);
  });

  it('reads a nasal with no vowel after it as ん, and a nasal before a vowel as an onset', () => {
    expect(phonesToMoraIntervals(phones('k(50) o(60) n(80) n(60) a(70)'))?.length).toBe(3); // こ ん な
    expect(phonesToMoraIntervals(phones('n(60) a(70)'))?.length).toBe(1); // な
  });

  it('recovers a devoiced vowel the aligner dropped between voiceless consonants (して, 大きさ)', () => {
    expect(ms(phonesToMoraIntervals(phones('ɕ(90) t(40) e(50)')))).toEqual([
      [0, 90], // し — only its consonant left a phone
      [90, 180], // て
    ]);
    expect(phonesToMoraIntervals(phones('oː(100) c(80) s(60) a(50)'))?.length).toBe(4); // お お き さ
  });

  it('recovers a token-final devoiced vowel (ま す → m a s)', () => {
    expect(ms(phonesToMoraIntervals(phones('i(50) m(90) a(60) s(350)')))).toEqual([
      [0, 50],
      [50, 200],
      [200, 550], // す — final devoiced vowel
    ]);
  });

  it('reads a token-final glottal stop as っ (思っ → o m o ʔ)', () => {
    expect(ms(phonesToMoraIntervals(phones('o(70) m(90) o(80) ʔ(40)')))).toEqual([
      [0, 70], // お
      [70, 240], // も
      [240, 280], // っ
    ]);
  });

  it('returns null for spoken noise or a voiced consonant left without a vowel', () => {
    expect(phonesToMoraIntervals(phones('k(50) spn(80)'))).toBeNull();
    expect(phonesToMoraIntervals(phones('k(50) a(60) z(70)'))).toBeNull();
    expect(phonesToMoraIntervals(phones('a(60) z(70) k(40) a(50)'))).toBeNull(); // z then k: voiced first
  });
});

describe('buildMoraMap / resolveMoraRange', () => {
  const japanese = '生まれた時から';
  const map = buildMoraMap(japanese, { inlineReading: '生まれ[うまれ]た時[とき]から' })!;

  it('gives every character of a ruby base the whole base range, kana one mora each', () => {
    expect(map.map((e) => [e.moraStart, e.moraEnd])).toEqual([
      [0, 3], [0, 3], [0, 3], // 生まれ
      [3, 4], // た
      [4, 6], // 時
      [6, 7], [7, 8], // から
    ]);
  });

  it('resolves a range on unit edges and refuses one that cuts through a unit', () => {
    expect(resolveMoraRange(map, 0, 3)).toEqual({ start: 0, end: 3 }); // 生まれ
    expect(resolveMoraRange(map, 0, 4)).toEqual({ start: 0, end: 4 }); // 生まれた
    expect(resolveMoraRange(map, 0, 1)).toBeNull(); // 生 alone — inside 生まれ's ruby
  });

  it('returns null when the reading does not spell the sentence', () => {
    expect(buildMoraMap('別の文', { inlineReading: '生まれ[うまれ]た' })).toBeNull();
  });

  it('maps small kana into the previous mora and refuses a cut between き and ゃ', () => {
    const m = buildMoraMap('きゃく', {})!;
    expect(m.map((e) => [e.moraStart, e.moraEnd])).toEqual([[0, 1], [0, 1], [1, 2]]);
    expect(resolveMoraRange(m, 0, 1)).toBeNull();
    expect(resolveMoraRange(m, 0, 2)).toEqual({ start: 0, end: 1 });
  });

  it('refuses a range containing a kanji with no reading', () => {
    const m = buildMoraMap('本を読む', {})!;
    expect(resolveMoraRange(m, 0, 2)).toBeNull();
  });
});

describe('isolatedWordSpans with a reading (sub-token cut)', () => {
  const word = (text: string, startMs: number, phoneSpec: string): WordAlignment => {
    const ph = phones(phoneSpec, startMs);
    return { text, start: ph[0]!.start, end: ph[ph.length - 1]!.end, phones: ph };
  };

  it('ends 生まれ at its last mora instead of the end of the token 生まれた', () => {
    const words = [
      { text: '<eps>', start: 0, end: 1, phones: [] },
      word('生まれた', 1000, 'ɯ(100) m(100) a(100) ɾ(40) e(80) t(90) a(100)'),
      word('時', 1610, 't(60) o(70) k(60) i(80)'),
    ];
    const reading = { inlineReading: '生まれ[うまれ]た時[とき]' };
    // れ ends at 1000+420 = 1420; the rest of the token (た) is right behind it → no tail pad.
    expect(isolatedWordSpans(words, '生まれた時', '生まれ', reading)).toEqual({
      wordOnly: { startMs: 970, endMs: 1420 },
      withParticle: null,
    });
    // Without a reading the span is the whole token, as before.
    expect(isolatedWordSpans(words, '生まれた時', '生まれ')?.wordOnly.endMs).toBe(1610); // 時 is adjacent → no pad
  });

  it('cuts 思っ after っ, in the middle of the geminate', () => {
    const words = [word('思っちゃう', 0, 'o(70) m(90) o(80) tɕː(80) a(60) ɯ(70)')];
    const range = isolatedWordRange(words, '思っちゃう', '思っ', { inlineReading: '思っ[おもっ]ちゃう' });
    expect(range).toEqual({ startMs: 0, endMs: 280 });
  });

  it('cuts 熊本 out of the token 熊本県', () => {
    const words = [
      word('熊本県', 0, 'k(90) ɯ(40) m(100) a(70) m(60) o(90) t(80) o(60) k(100) e(30) ɴ(110)'),
    ];
    const reading = { inlineReading: '熊本[くまもと]県[けん]' };
    // と ends at 90+40+100+70+60+90+80+60 = 590.
    expect(isolatedWordSpans(words, '熊本県', '熊本', reading)?.wordOnly.endMs).toBe(590);
  });

  it('keeps the token edge when the phones do not yield the reading’s mora count', () => {
    // The final た is missing entirely → 3 morae from phones vs 4 in the reading.
    const words = [word('生まれた', 0, 'ɯ(100) m(100) a(100) ɾ(40) e(80)')];
    const reading = { inlineReading: '生まれ[うまれ]た' };
    expect(isolatedWordSpans(words, '生まれた', '生まれ', reading)?.wordOnly.endMs).toBe(420 + 60); // token end + full tail pad
  });

  it('cuts genuinely short words too — a 180 ms cut is honoured (hand labels: 見, あり)', () => {
    // つけ ends at 180 ms inside the token つけて (250 ms); a 200 ms floor used to hand back the whole token.
    const words = [word('付けて', 0, 't(40) ɯ(50) k(40) e(50) t(40) e(30)')];
    const reading = { inlineReading: '付け[つけ]て' };
    expect(isolatedWordSpans(words, '付けて', '付け', reading)?.wordOnly).toEqual({ startMs: 0, endMs: 180 });
  });

  it('still refuses an implausibly short mora cut (under 60 ms) and keeps the token edge', () => {
    const words = [word('付けて', 0, 't(10) ɯ(10) k(10) e(10) t(40) e(30)')];
    const reading = { inlineReading: '付け[つけ]て' };
    expect(isolatedWordSpans(words, '付けて', '付け', reading)?.wordOnly.endMs).toBe(110 + 60);
  });

  it('leaves a target that is a whole token alone', () => {
    const words = [word('場所', 0, 'b(60) a(70) ɕ(100) o(110)')];
    const reading = { inlineReading: '場所[ばしょ]' };
    expect(isolatedWordSpans(words, '場所', '場所', reading)).toEqual(isolatedWordSpans(words, '場所', '場所'));
  });
});
