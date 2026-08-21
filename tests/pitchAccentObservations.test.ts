import { describe, expect, it } from 'vitest';

import type { WordAlignment } from '../src/domain/types';
import type { PitchAnalysisPayload, PitchFrame } from '../src/lib/pitch';
import {
  buildPitchAccentShapeObservations,
  type PitchAccentTarget,
} from '../src/lib/pitchAccentObservations';

function word(start: number, end: number, text: string): WordAlignment {
  return { start, end, text, phones: [] };
}

function frame(timeSeconds: number, relativeSemitones: number): PitchFrame {
  return { timeSeconds, hz: 150, voiced: true, confidence: 1, relativeSemitones };
}

function payload(frames: PitchFrame[]): PitchAnalysisPayload {
  return { frames, medianHz: 150, voicedRatio: 1, durationSeconds: frames.at(-1)?.timeSeconds ?? 0 };
}

/** Two evenly-spaced voiced frames per bucket at the given semitone. */
function twoMoraFrames(bucket0: number, bucket1: number): PitchFrame[] {
  return [frame(0.1, bucket0), frame(0.2, bucket0), frame(0.6, bucket1), frame(0.7, bucket1)];
}

describe('buildPitchAccentShapeObservations', () => {
  it('produces nothing when the learner matches the expected atamadaka shape', () => {
    const learnerWords = [word(0, 1, '雨')];
    const learnerPitch = payload(twoMoraFrames(5, -5)); // high then low = atamadaka
    const targets: PitchAccentTarget[] = [
      { surfaceForm: '雨', reading: 'あめ', pitchAccentPositions: [1] },
    ];

    expect(buildPitchAccentShapeObservations({ learnerWords, learnerPitch, targets })).toEqual([]);
  });

  it('flags an atamadaka target produced as heiban', () => {
    const learnerWords = [word(0, 1, '雨')];
    const learnerPitch = payload(twoMoraFrames(-5, 5)); // low then high = heiban
    const targets: PitchAccentTarget[] = [
      { surfaceForm: '雨', reading: 'あめ', pitchAccentPositions: [1] },
    ];

    const observations = buildPitchAccentShapeObservations({ learnerWords, learnerPitch, targets });
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      kind: 'pitch_accent_shape',
      confidence: 'medium',
      message: 'Dictionaries mark 「雨」 as atamadaka; your pitch here sounds like heiban instead.',
      segment: { startMs: 0, endMs: 1000 },
    });
    expect(observations[0]?.severity).toBeGreaterThan(0);
  });

  it('flags a nakadaka target produced as atamadaka', () => {
    const learnerWords = [word(0, 1.2, 'たまご')];
    const learnerPitch = payload([
      frame(0.1, 5),
      frame(0.2, 5), // bucket 0: high
      frame(0.5, -5),
      frame(0.6, -5), // bucket 1: low
      frame(0.9, -5),
      frame(1.0, -5), // bucket 2: low
    ]);
    const targets: PitchAccentTarget[] = [
      { surfaceForm: 'たまご', reading: 'たまご', pitchAccentPositions: [2] },
    ];

    const observations = buildPitchAccentShapeObservations({ learnerWords, learnerPitch, targets });
    expect(observations).toHaveLength(1);
    expect(observations[0]?.message).toBe(
      'Dictionaries mark 「たまご」 as nakadaka; your pitch here sounds like atamadaka instead.',
    );
  });

  it('does not flag an odaka target produced as heiban (acoustically identical within the word)', () => {
    const learnerWords = [word(0, 1, '橋')];
    const learnerPitch = payload(twoMoraFrames(-5, 5)); // low then high = heiban shape
    // Position 2 with 2 morae is odaka for this word.
    const targets: PitchAccentTarget[] = [
      { surfaceForm: '橋', reading: 'はし', pitchAccentPositions: [2] },
    ];

    expect(buildPitchAccentShapeObservations({ learnerWords, learnerPitch, targets })).toEqual([]);
  });

  it('skips a target whose surfaceForm has no matching aligned word', () => {
    const learnerWords = [word(0, 1, '違う言葉')];
    const learnerPitch = payload(twoMoraFrames(-5, 5));
    const targets: PitchAccentTarget[] = [
      { surfaceForm: '雨', reading: 'あめ', pitchAccentPositions: [1] },
    ];

    expect(buildPitchAccentShapeObservations({ learnerWords, learnerPitch, targets })).toEqual([]);
  });

  it('skips a word with too few voiced buckets to classify', () => {
    const learnerWords = [word(0, 1, '雨')];
    const learnerPitch = payload([frame(0.1, 5)]); // only the first bucket has any voiced signal
    const targets: PitchAccentTarget[] = [
      { surfaceForm: '雨', reading: 'あめ', pitchAccentPositions: [1] },
    ];

    expect(buildPitchAccentShapeObservations({ learnerWords, learnerPitch, targets })).toEqual([]);
  });

  it('notes alternate accepted positions in the detail when more than one is known', () => {
    const learnerWords = [word(0, 1, '雨')];
    const learnerPitch = payload(twoMoraFrames(-5, 5));
    const targets: PitchAccentTarget[] = [
      { surfaceForm: '雨', reading: 'あめ', pitchAccentPositions: [1, 0] },
    ];

    const observations = buildPitchAccentShapeObservations({ learnerWords, learnerPitch, targets });
    expect(observations[0]?.detail).toContain('Also acceptable: position 0');
  });

  it('skips a target with no pitch-accent data at all', () => {
    const learnerWords = [word(0, 1, '雨')];
    const learnerPitch = payload(twoMoraFrames(-5, 5));
    const targets: PitchAccentTarget[] = [
      { surfaceForm: '雨', reading: 'あめ', pitchAccentPositions: [] },
    ];

    expect(buildPitchAccentShapeObservations({ learnerWords, learnerPitch, targets })).toEqual([]);
  });
});
