import { describe, expect, it } from 'vitest';

import type { WordAlignment } from '../src/domain/types';
import type { PitchAnalysisPayload, PitchFrame } from '../src/lib/pitch';
import {
  buildLearnerPitchAccentShapes,
  buildPitchAccentShapeObservations,
  classifyLearnerMorae,
  FLAT_CONTRAST_SEMITONES,
  gradeLearnerMorae,
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

  it('names the drop mora when both sides are nakadaka but the drop is misplaced', () => {
    // 親鳥 (おやどり): dictionary drop after や (mora 2); learner keeps the
    // pitch high one mora too long and drops after ど (mora 3). Both are
    // "nakadaka" — the old message read "sounds like nakadaka instead".
    const learnerWords = [word(0, 1.6, '親鳥')];
    const learnerPitch = payload([
      frame(0.1, -5),
      frame(0.3, -5), // mora 1 お: low
      frame(0.5, 5),
      frame(0.7, 5), // mora 2 や: high
      frame(0.9, 5),
      frame(1.1, 5), // mora 3 ど: high (should have dropped)
      frame(1.3, -5),
      frame(1.5, -5), // mora 4 り: low
    ]);
    const targets: PitchAccentTarget[] = [
      { surfaceForm: '親鳥', reading: 'おやどり', pitchAccentPositions: [2] },
    ];

    const observations = buildPitchAccentShapeObservations({ learnerWords, learnerPitch, targets });
    expect(observations).toHaveLength(1);
    expect(observations[0]?.message).toBe(
      'Both the dictionary and your recording read 「親鳥」 as nakadaka — the drop is just in the wrong place. It belongs after 「や」 (mora 2), but yours stays high 1 mora too long and drops after 「ど」 (mora 3).',
    );
    expect(observations[0]?.hint).toContain('Treat 「や」 as the peak');
  });

  it('flags a raised opening mora even when the drop position is right', () => {
    // たまご nakadaka [2] = L-H-L. Learner produces H-H-L: the drop after
    // mora 2 is correct, but the first mora is up (English initial stress).
    const learnerWords = [word(0, 1.2, 'たまご')];
    const learnerPitch = payload([
      frame(0.1, 5),
      frame(0.3, 5), // mora 1 た: high (should be low)
      frame(0.5, 5),
      frame(0.7, 5), // mora 2 ま: high
      frame(0.9, -8),
      frame(1.1, -8), // mora 3 ご: low
    ]);
    const targets: PitchAccentTarget[] = [
      { surfaceForm: 'たまご', reading: 'たまご', pitchAccentPositions: [2] },
    ];

    const observations = buildPitchAccentShapeObservations({ learnerWords, learnerPitch, targets });
    expect(observations).toHaveLength(1);
    expect(observations[0]?.message).toContain('started 「たまご」 high on 「た」');
    expect(observations[0]?.hint).toContain('first syllable');
    expect(observations[0]?.confidence).toBe('medium');
  });

  it('does not flag a same-drop-position mora diff that lands on a carried-forward bucket', () => {
    // 4 morae, nakadaka [3] = L-H-H-L. Mora 2's bucket has no voiced signal,
    // so its class is carried forward from the (low) first mora — a diff
    // there is a measurement gap, not a produced error.
    const learnerWords = [word(0, 1.6, 'あいうえ')];
    const learnerPitch = payload([
      frame(0.1, -5),
      frame(0.3, -5), // mora 1: low
      // mora 2 (0.4–0.8): silent
      frame(0.9, 5),
      frame(1.1, 5), // mora 3: high
      frame(1.3, -5),
      frame(1.5, -5), // mora 4: low
    ]);
    const targets: PitchAccentTarget[] = [
      { surfaceForm: 'あいうえ', reading: 'あいうえ', pitchAccentPositions: [3] },
    ];

    expect(
      buildPitchAccentShapeObservations({ learnerWords, learnerPitch, targets }),
    ).toEqual([]);
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
      { surfaceForm: '雨', classes: ['h', 'l'], voicedBucketCount: 2, moraCount: 2, contrastSemitones: 10 },
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

describe('classifyLearnerMorae with exact mora intervals', () => {
  // おーき: a long first vowel, so the morae are 0–150, 150–300 and 300–400 ms — not equal thirds.
  // Pitch is low until 210 ms and high after it. The middle mora (150–300) is mostly high, but
  // the equal-width middle bucket (133–267) is mostly low, so equal slices misread it.
  const pitch = payload(Array.from({ length: 40 }, (_, i) => frame(i * 0.01 + 0.005, i * 0.01 + 0.005 < 0.21 ? 0 : 4)));
  const phones = [
    { text: 'oː', start: 0, end: 0.3 },
    { text: 'k', start: 0.3, end: 0.35 },
    { text: 'i', start: 0.35, end: 0.4 },
  ];
  const withPhones: WordAlignment = { start: 0, end: 0.4, text: 'おおき', phones };
  const withoutPhones: WordAlignment = { ...withPhones, phones: [] };

  it('uses the word’s own phones to find the morae, so a long vowel does not skew the buckets', () => {
    expect(classifyLearnerMorae(withPhones, 3, pitch)?.classes.join('')).toBe('lhh');
  });

  it('falls back to equal-width buckets without phones (the old behaviour)', () => {
    expect(classifyLearnerMorae(withoutPhones, 3, pitch)?.classes.join('')).toBe('llh');
  });

  it('honours an explicit interval list, and null opts out of the phone-derived one', () => {
    expect(classifyLearnerMorae(withoutPhones, 3, pitch, null, [
      { start: 0, end: 0.15 }, { start: 0.15, end: 0.3 }, { start: 0.3, end: 0.4 },
    ])?.classes.join('')).toBe('lhh');
    expect(classifyLearnerMorae(withPhones, 3, pitch, null, null)?.classes.join('')).toBe('llh');
  });

  it('ignores phones whose mora count does not match the expected reading', () => {
    // Expected 4 morae but the phones give 3 → equal-width buckets, exactly as before.
    expect(classifyLearnerMorae(withPhones, 4, pitch)?.classes).toHaveLength(4);
    const equal = classifyLearnerMorae(withoutPhones, 4, pitch);
    expect(classifyLearnerMorae(withPhones, 4, pitch)?.bucketMeans).toEqual(equal?.bucketMeans);
  });
});

describe('gradeLearnerMorae', () => {
  /** Four buckets of 0.5 s over a 2 s word, two voiced frames per bucket at the given semitones. */
  const fourMoraPitch = (levels: number[]) =>
    payload(levels.flatMap((level, i) => [frame(i * 0.5 + 0.1, level), frame(i * 0.5 + 0.3, level)]));
  const tomodachi = word(0, 2, 'ともだち');
  const heiban: PitchAccentTarget = { surfaceForm: 'ともだち', reading: 'ともだち', pitchAccentPositions: [0] };

  // A correctly-produced heiban plateau whose last mora drifts a hair below the word's mean.
  const plateau = fourMoraPitch([-3, 3, 2, 0]);

  it('rescues a plateau the per-mora rule mis-reads: the raw rule says accented, the grader agrees with the dictionary', () => {
    expect(classifyLearnerMorae(tomodachi, 4, plateau)?.classes.join('')).toBe('lhhl');
    const graded = gradeLearnerMorae(tomodachi, 4, plateau, null, 0);
    expect(graded?.classes.join('')).toBe('lhhh');
    expect(graded?.flat).toBe(false);
    expect(
      buildPitchAccentShapeObservations({ learnerWords: [tomodachi], learnerPitch: plateau, targets: [heiban] }),
    ).toEqual([]);
  });

  it('does not rescue a take that really drops on the last mora', () => {
    const drop = fourMoraPitch([-3, 3, 3, -4]);
    expect(gradeLearnerMorae(tomodachi, 4, drop, null, 0)?.classes.join('')).toBe('lhhl');
    const observations = buildPitchAccentShapeObservations({ learnerWords: [tomodachi], learnerPitch: drop, targets: [heiban] });
    expect(observations).toHaveLength(1);
    expect(observations[0]?.message).not.toContain('barely moved');
  });

  it('does not rescue a drop that lands a mora late, even though a valid shape fits it (a real stored take)', () => {
    // 元気 (atamadaka): measured 1.3 / 0.7 / -4.2 st — the second mora barely fell; the drop came a mora late.
    const genki = word(0, 1.5, 'げんき');
    const lateDrop = payload(
      [1.3, 0.7, -4.2].flatMap((level, i) => [frame(i * 0.5 + 0.1, level), frame(i * 0.5 + 0.3, level)]),
    );
    const graded = gradeLearnerMorae(genki, 3, lateDrop, null, 1);
    expect(graded?.classes.join('')).toBe('hhl');
    const target: PitchAccentTarget = { surfaceForm: 'げんき', reading: 'げんき', pitchAccentPositions: [1] };
    expect(buildPitchAccentShapeObservations({ learnerWords: [genki], learnerPitch: lateDrop, targets: [target] })).toHaveLength(1);
  });

  it('never rewrites a raised opening mora: the raw reading (and its diagnosis) stands', () => {
    const raised = fourMoraPitch([3, 3, 3, -4]);
    expect(gradeLearnerMorae(tomodachi, 4, raised, null, 0)?.classes.join('')).toBe(
      classifyLearnerMorae(tomodachi, 4, raised)?.classes.join(''),
    );
  });

  it('flags a level take as flat instead of letting it fit heiban', () => {
    const level = fourMoraPitch([0.1, 0, 0.1, 0]);
    const graded = gradeLearnerMorae(tomodachi, 4, level, null, 0);
    expect(graded?.flat).toBe(true);
    expect(graded?.contrastSemitones).toBeLessThan(FLAT_CONTRAST_SEMITONES);

    const observations = buildPitchAccentShapeObservations({ learnerWords: [tomodachi], learnerPitch: level, targets: [heiban] });
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ kind: 'pitch_accent_shape', confidence: 'low', subject: 'ともだち' });
    expect(observations[0]?.message).toContain('barely moved');
    expect(observations[0]?.hint).toContain('start 「と」 low and step clearly up onto 「も」');

    const shapes = buildLearnerPitchAccentShapes({ learnerWords: [tomodachi], learnerPitch: level, targets: [heiban] });
    expect(shapes[0]?.flat).toBe(true);
  });

  it('leaves one-mora words and unfittable takes on the descriptive reading', () => {
    const graded = gradeLearnerMorae(word(0, 0.4, 'め'), 1, payload([frame(0.1, 3), frame(0.2, 3)]), null, 1);
    expect(graded?.flat).toBe(false);
    expect(graded?.contrastSemitones).toBeNull();
  });
});
