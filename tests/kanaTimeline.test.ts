import { describe, expect, it } from 'vitest';

import { buildKanaTimeline } from '../src/lib/kanaTimeline';
import { segmentIntoMorae } from '../src/lib/mora';
import type { WordAlignment } from '../src/domain/types';

function word(text: string, start: number, end: number): WordAlignment {
  return { text, start, end, phones: [] };
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

  it('returns nothing for a non-positive duration', () => {
    expect(buildKanaTimeline({ words: [word('ねこ', 0, 1)], moraUnits, durationSeconds: 0 })).toEqual(
      [],
    );
  });
});
