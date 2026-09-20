import { describe, expect, it } from 'vitest';

import type { WordAlignment } from '../src/domain/types';
import { segmentIntoMorae } from '../src/lib/mora';
import type { PitchAnalysisPayload } from '../src/lib/pitch';
import { buildPhrasePitch } from '../src/lib/phrasePitch';
import { buildPhrasePitchSnapshot } from '../src/lib/phrasePitchSnapshot';

const word = (text: string, start: number, end: number, phones: [string, number, number][]): WordAlignment => ({
  text,
  start,
  end,
  phones: phones.map(([t, s, e]) => ({ text: t, start: s, end: e })),
});

const words: WordAlignment[] = [
  word('はし', 0, 0.2, [['h', 0, 0.05], ['a', 0.05, 0.1], ['ɕ', 0.1, 0.15], ['i', 0.15, 0.2]]),
];
const pitch: PitchAnalysisPayload = {
  frames: [
    { timeSeconds: 0.05, hz: 150, voiced: true, confidence: 1, relativeSemitones: 0 },
    { timeSeconds: 0.15, hz: 170, voiced: true, confidence: 1, relativeSemitones: 2 },
    { timeSeconds: 0.19, hz: null, voiced: false, confidence: 0, relativeSemitones: null },
  ],
  medianHz: 150,
  voicedRatio: 0.66,
  durationSeconds: 0.2,
};

describe('buildPhrasePitchSnapshot', () => {
  it('captures the rows, both speakers’ compact timings and voiced frame counts as JSON', () => {
    const moraUnits = segmentIntoMorae('はし');
    const result = buildPhrasePitch({ reference: { words, pitch }, learner: { words, pitch } });
    const snapshot = JSON.parse(
      buildPhrasePitchSnapshot({
        sentenceId: 's1',
        attemptId: 'a1',
        japanese: '橋',
        moraUnits,
        result,
        reference: { words, pitch, pitchOffsetSeconds: 0 },
        learner: { words, pitch },
      }),
    );
    expect(snapshot).toMatchObject({ kind: 'phrase-pitch', sentenceId: 's1', attemptId: 'a1', moraKana: 'は し' });
    expect(snapshot.result.rows[0]).toMatchObject({ text: 'はし', kana: 'はし', status: 'match', native: 'lh' });
    expect(snapshot.reference.words[0].phones[0]).toBe('h:0-0.05');
    expect(snapshot.learner.voicedFramesPerToken).toEqual(['2/3']);
  });

  it('records a missing learner as null', () => {
    const moraUnits = segmentIntoMorae('はし');
    const result = buildPhrasePitch({ reference: { words, pitch } });
    const snapshot = JSON.parse(
      buildPhrasePitchSnapshot({ sentenceId: 's', attemptId: 'a', japanese: '橋', moraUnits, result, reference: { words, pitch, pitchOffsetSeconds: 0 } }),
    );
    expect(snapshot.learner).toBeNull();
  });
});
