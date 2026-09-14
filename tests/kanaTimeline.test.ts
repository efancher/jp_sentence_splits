import { describe, expect, it } from 'vitest';

import { buildKanaTimeline } from '../src/lib/kanaTimeline';
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
});
