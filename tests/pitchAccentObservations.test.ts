import { describe, expect, it } from 'vitest';

import type { WordAlignment } from '../src/domain/types';
import type { PitchAnalysisPayload, PitchFrame } from '../src/lib/pitch';
import {
  buildLearnerPitchAccentShapes,
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

  describe('odaka vs heiban, disambiguated by the following particle', () => {
    // 橋 (はし) is odaka: low-high on its own morae, then the particle drops.
    const odakaTarget: PitchAccentTarget[] = [
      { surfaceForm: '橋', reading: 'はし', pitchAccentPositions: [2], followingMora: 'が' },
    ];

    it('flags an odaka word whose following particle stayed high (produced as heiban)', () => {
      const learnerWords = [word(0, 1, '橋'), word(1, 1.3, 'が')];
      const learnerPitch = payload([
        ...twoMoraFrames(-5, 5), // low then high on 橋 — correct so far
        frame(1.05, 5),
        frame(1.15, 5), // particle stays high → heiban, not odaka
      ]);

      const observations = buildPitchAccentShapeObservations({
        learnerWords,
        learnerPitch,
        targets: odakaTarget,
      });
      expect(observations).toHaveLength(1);
      expect(observations[0]?.message).toBe(
        'Dictionaries mark 「橋」 as odaka: the pitch drops on the particle after it, but yours stays up there — it sounds like heiban.',
      );
    });

    it('does not flag when the following particle dropped (produced as odaka)', () => {
      const learnerWords = [word(0, 1, '橋'), word(1, 1.3, 'が')];
      const learnerPitch = payload([
        ...twoMoraFrames(-5, 5),
        frame(1.05, -6),
        frame(1.15, -6), // particle drops → correct odaka
      ]);

      expect(
        buildPitchAccentShapeObservations({ learnerWords, learnerPitch, targets: odakaTarget }),
      ).toEqual([]);
    });

    it('flags a heiban word whose following particle dropped (produced as odaka)', () => {
      const heibanTarget: PitchAccentTarget[] = [
        { surfaceForm: '水', reading: 'みず', pitchAccentPositions: [0], followingMora: 'が' },
      ];
      const learnerWords = [word(0, 1, '水'), word(1, 1.3, 'が')];
      const learnerPitch = payload([
        ...twoMoraFrames(-5, 5),
        frame(1.05, -6),
        frame(1.15, -6),
      ]);

      const observations = buildPitchAccentShapeObservations({
        learnerWords,
        learnerPitch,
        targets: heibanTarget,
      });
      expect(observations).toHaveLength(1);
      expect(observations[0]?.message).toBe(
        'Dictionaries mark 「水」 as heiban: the pitch stays up on the particle after it, but yours drops there — it sounds like odaka.',
      );
    });

    it('stays collapsed when the particle has too little voiced signal to judge', () => {
      const learnerWords = [word(0, 1, '橋'), word(1, 1.3, 'が')];
      const learnerPitch = payload([...twoMoraFrames(-5, 5), frame(1.05, 5)]); // one particle frame only

      expect(
        buildPitchAccentShapeObservations({ learnerWords, learnerPitch, targets: odakaTarget }),
      ).toEqual([]);
    });

    it('stays collapsed when no followingMora is supplied', () => {
      const learnerWords = [word(0, 1, '橋'), word(1, 1.3, 'が')];
      const learnerPitch = payload([...twoMoraFrames(-5, 5), frame(1.05, 5), frame(1.15, 5)]);
      const targets: PitchAccentTarget[] = [
        { surfaceForm: '橋', reading: 'はし', pitchAccentPositions: [2] },
      ];

      expect(buildPitchAccentShapeObservations({ learnerWords, learnerPitch, targets })).toEqual([]);
    });
  });
});

describe('buildLearnerPitchAccentShapes', () => {
  it('returns the learner per-mora shape even when it matches the dictionary', () => {
    const learnerWords = [word(0, 1, '雨')];
    const learnerPitch = payload(twoMoraFrames(5, -5)); // high then low = atamadaka
    const targets: PitchAccentTarget[] = [
      { surfaceForm: '雨', reading: 'あめ', pitchAccentPositions: [1] },
    ];

    expect(buildLearnerPitchAccentShapes({ learnerWords, learnerPitch, targets })).toEqual([
      { surfaceForm: '雨', classes: ['h', 'l'], voicedBucketCount: 2, moraCount: 2 },
    ]);
  });

  it('reports the produced shape when it differs from the dictionary', () => {
    const learnerWords = [word(0, 1, '雨')];
    const learnerPitch = payload(twoMoraFrames(-5, 5)); // low then high = heiban shape
    const targets: PitchAccentTarget[] = [
      { surfaceForm: '雨', reading: 'あめ', pitchAccentPositions: [1] },
    ];

    expect(buildLearnerPitchAccentShapes({ learnerWords, learnerPitch, targets })[0]?.classes).toEqual([
      'l',
      'h',
    ]);
  });

  it('reports the measured level of the following particle when asked for it', () => {
    const learnerWords = [word(0, 1, '橋'), word(1, 1.3, 'が')];
    const learnerPitch = payload([
      ...twoMoraFrames(-5, 5),
      frame(1.05, -6),
      frame(1.15, -6), // particle drops
    ]);
    const targets: PitchAccentTarget[] = [
      { surfaceForm: '橋', reading: 'はし', pitchAccentPositions: [2], followingMora: 'が' },
    ];

    const shapes = buildLearnerPitchAccentShapes({ learnerWords, learnerPitch, targets });
    expect(shapes[0]?.classes).toEqual(['l', 'h']); // word row unchanged length
    expect(shapes[0]?.followingClass).toBe('l');
  });

  it('omits a target whose word is missing or has too little voiced signal', () => {
    const targets: PitchAccentTarget[] = [
      { surfaceForm: '雨', reading: 'あめ', pitchAccentPositions: [1] },
    ];

    expect(
      buildLearnerPitchAccentShapes({
        learnerWords: [word(0, 1, '違う')],
        learnerPitch: payload(twoMoraFrames(-5, 5)),
        targets,
      }),
    ).toEqual([]);
    expect(
      buildLearnerPitchAccentShapes({
        learnerWords: [word(0, 1, '雨')],
        learnerPitch: payload([frame(0.1, 5)]),
        targets,
      }),
    ).toEqual([]);
  });
});
