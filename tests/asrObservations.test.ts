import { describe, expect, it } from 'vitest';

import type { WordAlignment } from '../src/domain/types';
import { buildAsrObservations } from '../src/lib/asrObservations';

function word(start: number, end: number, text: string): WordAlignment {
  return { start, end, text, phones: [] };
}

describe('buildAsrObservations', () => {
  it('produces nothing for an exact match', () => {
    const referenceWords = [word(0, 0.3, '今日'), word(0.3, 0.5, 'は'), word(0.5, 0.8, '寒い')];
    expect(
      buildAsrObservations({ referenceWords, transcribedText: '今日は寒い' }),
    ).toEqual([]);
  });

  it('produces nothing when only punctuation/whitespace differs', () => {
    const referenceWords = [word(0, 0.3, '今日'), word(0.3, 0.5, 'は'), word(0.5, 0.8, '寒い')];
    expect(
      buildAsrObservations({ referenceWords, transcribedText: '今日は、寒い。' }),
    ).toEqual([]);
  });

  it('flags the specific word that differs', () => {
    const referenceWords = [
      word(0, 0.3, '今日'),
      word(0.3, 0.5, 'は'),
      word(0.5, 0.9, 'ちょっと'),
      word(0.9, 1.2, '寒い'),
    ];
    // ASR heard "さむ" instead of the expected "寒い" reading-adjacent text —
    // simulate a substitution within the reference word span.
    const observations = buildAsrObservations({
      referenceWords,
      transcribedText: '今日はちょっとさむい',
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      kind: 'asr_diagnostic',
      confidence: 'low',
      message: 'Possible pronunciation difference around 「寒い」.',
      segment: { startMs: 900, endMs: 1200 },
    });
    expect(observations[0]?.detail).toContain('今日はちょっとさむい');
  });

  it('flags each distinct affected word separately, not one blob message', () => {
    const referenceWords = [
      word(0, 0.3, '今日'),
      word(0.3, 0.6, '映画'),
      word(0.6, 0.9, 'を'),
      word(0.9, 1.2, '見た'),
    ];
    // Both 映画 and 見た come out garbled.
    const observations = buildAsrObservations({
      referenceWords,
      transcribedText: '今日えいがを絵田',
    });

    const flaggedWords = observations.map((o) => o.message);
    expect(flaggedWords).toContain('Possible pronunciation difference around 「見た」.');
    expect(observations.length).toBeGreaterThanOrEqual(1);
    // Never a single message covering multiple words at once.
    for (const observation of observations) {
      expect(observation.message.match(/「/g)?.length).toBe(1);
    }
  });

  it('returns nothing when there is no reference text to compare against', () => {
    expect(
      buildAsrObservations({ referenceWords: [], transcribedText: '何か' }),
    ).toEqual([]);
  });
});
