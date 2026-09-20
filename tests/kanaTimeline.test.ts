import { describe, expect, it } from 'vitest';

import { buildKanaTimeline, exactMoraIntervals } from '../src/lib/kanaTimeline';
import { segmentIntoMorae } from '../src/lib/mora';
import type { PhoneAlignment, WordAlignment } from '../src/domain/types';

function word(text: string, start: number, end: number, phones: PhoneAlignment[] = []): WordAlignment {
  return { text, start, end, phones };
}

function phone(text: string, start: number, end: number): PhoneAlignment {
  return { text, start, end };
}

describe('buildKanaTimeline', () => {
  // Kana-length aligner tokens so the char-proportion mapping lands exactly;
  // with kanji tokens it is a documented approximation, not an equality.
  const moraUnits = segmentIntoMorae('ねこがすき'); // ね こ が す き

  it('splits the kana across words by character proportion and positions them in time', () => {
    const words = [word('ねこ', 0, 1), word('が', 1, 1.4), word('すき', 1.4, 2.4)];
    const entries = buildKanaTimeline({ words, moraUnits, durationSeconds: 2.4 });

    expect(entries.map((entry) => entry.text).join('|')).toBe('ねこ|が|すき');
    expect(entries[0].leftPct).toBeCloseTo(0);
    expect(entries[1].leftPct).toBeCloseTo((1 / 2.4) * 100);
    expect(entries[2].leftPct).toBeCloseTo((1.4 / 2.4) * 100);
    expect(entries[2].widthPct).toBeCloseTo((1 / 2.4) * 100);
  });

  it('falls back to the aligner token when there is no reading', () => {
    const words = [word('今日', 0, 1), word('は', 1, 1.4)];
    const entries = buildKanaTimeline({ words, moraUnits: [], durationSeconds: 1.4 });

    expect(entries.map((entry) => entry.text)).toEqual(['今日', 'は']);
  });

  it('drops silence/epsilon tokens', () => {
    const words = [word('<eps>', 0, 0.3), word('ねこがすき', 0.3, 1), word('<sil>', 1, 1.2)];
    const entries = buildKanaTimeline({ words, moraUnits, durationSeconds: 1.2 });

    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('ねこがすき');
  });

  it('subtracts the practice-target offset and drops words outside the window', () => {
    const words = [word('ねこ', 0, 1), word('が', 1, 1.4), word('すき', 1.4, 2.4)];
    // Contour is sliced to [1.0s, 2.4s]; ねこ falls entirely before it.
    const entries = buildKanaTimeline({
      words,
      moraUnits,
      durationSeconds: 1.4,
      timeOffsetSeconds: 1,
    });

    expect(entries.map((entry) => entry.text)).toEqual(['が', 'すき']);
    expect(entries[0].leftPct).toBeCloseTo(0);
    expect(entries[0].start).toBeCloseTo(0);
  });

  it('spreads a multi-mora word across its own phone timing instead of bunching it', () => {
    // す = /s/ /u/, き = /k/ /i/ — き's phones run twice as long as す's here,
    // as if the learner dragged it out; the split should show that, not an
    // even 50/50 division of the word's [1.0, 2.0] span.
    const words = [
      word('すき', 1.0, 2.0, [
        phone('s', 1.0, 1.1),
        phone('u', 1.1, 1.3),
        phone('k', 1.3, 1.6),
        phone('i', 1.6, 2.0),
      ]),
    ];
    const entries = buildKanaTimeline({
      words,
      moraUnits: segmentIntoMorae('すき'),
      durationSeconds: 2.0,
    });

    expect(entries.map((entry) => entry.text)).toEqual(['す', 'き']);
    expect(entries[0].start).toBeCloseTo(1.0);
    expect(entries[0].end).toBeCloseTo(1.3);
    expect(entries[1].start).toBeCloseTo(1.3);
    expect(entries[1].end).toBeCloseTo(2.0);
  });

  it('keeps one label for a single-mora word even when phones are present', () => {
    const words = [word('き', 0, 0.4, [phone('k', 0, 0.1), phone('i', 0.1, 0.4)])];
    const entries = buildKanaTimeline({
      words,
      moraUnits: segmentIntoMorae('き'),
      durationSeconds: 0.4,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('き');
    expect(entries[0].start).toBeCloseTo(0);
    expect(entries[0].end).toBeCloseTo(0.4);
  });

  it('returns nothing for a non-positive duration', () => {
    expect(buildKanaTimeline({ words: [word('ねこ', 0, 1)], moraUnits, durationSeconds: 0 })).toEqual(
      [],
    );
  });

  describe('exact path (phones parse into exactly the reading’s morae)', () => {
    // 生まれた時 = うまれたとき (6 morae): real MFA phone shapes, laid end to end.
    const ph = (spec: string, startMs: number) => {
      let t = startMs;
      return spec.split(' ').map((item) => {
        const [, label, ms] = /^(.+)\((\d+)\)$/.exec(item)!;
        const start = t / 1000;
        t += Number(ms);
        return phone(label!, start, t / 1000);
      });
    };
    const umareta = ph('ɯ(100) m(100) a(100) ɾ(40) e(80) t(90) a(100)', 1000);
    const toki = ph('t(60) o(70) k(60) i(80)', 1610);
    const words = [
      word('生まれた', 1, 1.61, umareta),
      word('時', 1.61, 1.88, toki),
    ];
    const reading = segmentIntoMorae('うまれたとき');

    it('gives every mora its own measured interval, not a share of a proportional guess', () => {
      const entries = buildKanaTimeline({ words, moraUnits: reading, durationSeconds: 3 });
      expect(entries.map((e) => e.text)).toEqual(['う', 'ま', 'れ', 'た', 'と', 'き']);
      expect(entries.map((e) => [Math.round(e.start * 1000), Math.round(e.end * 1000)])).toEqual([
        [1000, 1100], // う
        [1100, 1300], // ま  (m + a)
        [1300, 1420], // れ  (ɾ + e)
        [1420, 1610], // た  (t + a)
        [1610, 1740], // と
        [1740, 1880], // き
      ]);
    });

    it('splits a long vowel across its two morae (ラーメン)', () => {
      const ramen = word('ラーメン', 0, 0.77, ph('ɾ(50) aː(290) m(90) e(140) ɴ(200)', 0));
      const entries = buildKanaTimeline({ words: [ramen], moraUnits: segmentIntoMorae('ラーメン'), durationSeconds: 1 });
      expect(entries.map((e) => e.text)).toEqual(['ラ', 'ー', 'メ', 'ン']);
      expect(Math.round(entries[0]!.end * 1000)).toBe(195); // the long vowel's midpoint
      expect(Math.round(entries[1]!.start * 1000)).toBe(195);
    });

    it('falls back to the approximation when the reading has a mora the speech does not (にっぽん vs にほん)', () => {
      const moreMorae = segmentIntoMorae('うまれたときな'); // 7 morae vs 6 from the phones
      expect(exactMoraIntervals(words, moreMorae)).toBeNull();
      const entries = buildKanaTimeline({ words, moraUnits: moreMorae, durationSeconds: 3 });
      // Still labels every mora, but by the proportional spread — not the measured う = 1000–1100 ms.
      expect(entries).toHaveLength(7);
      expect([Math.round(entries[0]!.start * 1000), Math.round(entries[0]!.end * 1000)]).not.toEqual([1000, 1100]);
    });

    it('falls back when a token is unaligned (<unk>): its morae are in the reading but not in any token', () => {
      // The reading covers the whole sentence, including な for the unaligned word.
      const readingWithUnk = segmentIntoMorae('なうまれたとき');
      const withUnk = [word('<unk>', 0.5, 1), ...words];
      expect(exactMoraIntervals(words, readingWithUnk)).toBeNull(); // 6 measured vs 7 in the reading
      const entries = buildKanaTimeline({ words: withUnk, moraUnits: readingWithUnk, durationSeconds: 3 });
      expect(entries.length).toBeGreaterThan(0); // still draws something — the old path
    });

    it('refuses to guess when any token has no usable phones', () => {
      expect(exactMoraIntervals([word('生まれた', 1, 1.61, [])], segmentIntoMorae('うまれた'))).toBeNull();
      expect(exactMoraIntervals([word('あ', 0, 1, [phone('spn', 0, 1)])], segmentIntoMorae('あ'))).toBeNull();
      expect(exactMoraIntervals([], segmentIntoMorae('あ'))).toBeNull();
    });
  });
});
