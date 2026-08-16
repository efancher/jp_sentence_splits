import { describe, expect, it } from 'vitest';

import type { PitchAnalysisPayload, PitchFrame } from '../src/lib/pitch';
import { buildPitchTimingObservations } from '../src/lib/pitchTimingObservations';
import type { WordAlignment } from '../src/domain/types';

function word(start: number, end: number, text: string): WordAlignment {
  return { start, end, text, phones: [] };
}

/** Evenly-spaced voiced frames over [start, end), semitones interpolated linearly semitoneStart -> semitoneEnd. */
function linearFrames(
  start: number,
  end: number,
  semitoneStart: number,
  semitoneEnd: number,
  count = 10,
): PitchFrame[] {
  const frames: PitchFrame[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = start + ((end - start) * i) / (count - 1);
    const semitone = semitoneStart + ((semitoneEnd - semitoneStart) * i) / (count - 1);
    frames.push({ timeSeconds: t, hz: 150, voiced: true, confidence: 1, relativeSemitones: semitone });
  }
  return frames;
}

/** Frames that rise then fall (or fall then rise) with a turning point at `turnFraction` of the span. */
function peakFrames(
  start: number,
  end: number,
  turnFraction: number,
  peakSemitone: number,
  baseSemitone: number,
  count = 12,
): PitchFrame[] {
  const frames: PitchFrame[] = [];
  const turnIndex = Math.round(turnFraction * (count - 1));
  for (let i = 0; i < count; i += 1) {
    const t = start + ((end - start) * i) / (count - 1);
    const semitone = i <= turnIndex ? peakSemitone : baseSemitone;
    frames.push({ timeSeconds: t, hz: 150, voiced: true, confidence: 1, relativeSemitones: semitone });
  }
  return frames;
}

function payload(frames: PitchFrame[]): PitchAnalysisPayload {
  return { frames, medianHz: 150, voicedRatio: 1, durationSeconds: frames.at(-1)?.timeSeconds ?? 0 };
}

describe('buildPitchTimingObservations', () => {
  it('flags a later pitch drop when both fall but at different points', () => {
    const referenceWords = [word(0, 1, '見に')];
    const learnerWords = [word(0, 1, '見に')];
    // Reference falls early (turn at 20% through), learner falls late (turn at 80%).
    const referencePitch = payload(peakFrames(0, 1, 0.2, 5, -2));
    const learnerPitch = payload(peakFrames(0, 1, 0.8, 5, -2));

    const observations = buildPitchTimingObservations({
      referenceWords,
      learnerWords,
      referencePitch,
      learnerPitch,
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      kind: 'pitch_timing',
      confidence: 'medium',
      message: 'Your pitch drop occurs later than the reference around 「見に」.',
    });
  });

  it('flags an earlier pitch drop', () => {
    const referenceWords = [word(0, 1, '見に')];
    const learnerWords = [word(0, 1, '見に')];
    const referencePitch = payload(peakFrames(0, 1, 0.8, 5, -2));
    const learnerPitch = payload(peakFrames(0, 1, 0.2, 5, -2));

    const observations = buildPitchTimingObservations({
      referenceWords,
      learnerWords,
      referencePitch,
      learnerPitch,
    });

    expect(observations[0]?.message).toBe(
      'Your pitch drop occurs earlier than the reference around 「見に」.',
    );
  });

  it('describes a shape mismatch (reference falls, learner stays level) at low confidence', () => {
    const referenceWords = [word(0, 1, '寒い')];
    const learnerWords = [word(0, 1, '寒い')];
    const referencePitch = payload(linearFrames(0, 1, 4, -3));
    const learnerPitch = payload(linearFrames(0, 1, 1, 1.2));

    const observations = buildPitchTimingObservations({
      referenceWords,
      learnerWords,
      referencePitch,
      learnerPitch,
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      kind: 'pitch_shape',
      confidence: 'low',
      message: 'Your pitch stays level during 「寒い」 where the reference falls.',
    });
  });

  it('produces nothing when both sides fall at roughly the same point', () => {
    const referenceWords = [word(0, 1, '見に')];
    const learnerWords = [word(0, 1, '見に')];
    const referencePitch = payload(peakFrames(0, 1, 0.4, 5, -2));
    const learnerPitch = payload(peakFrames(0, 1, 0.5, 5, -2));

    expect(
      buildPitchTimingObservations({ referenceWords, learnerWords, referencePitch, learnerPitch }),
    ).toEqual([]);
  });

  it('produces nothing when both sides are flat', () => {
    const referenceWords = [word(0, 1, 'です')];
    const learnerWords = [word(0, 1, 'です')];
    const referencePitch = payload(linearFrames(0, 1, 0, 0.3));
    const learnerPitch = payload(linearFrames(0, 1, -0.2, 0.1));

    expect(
      buildPitchTimingObservations({ referenceWords, learnerWords, referencePitch, learnerPitch }),
    ).toEqual([]);
  });

  it('skips a word with too few voiced frames to classify', () => {
    const referenceWords = [word(0, 0.05, 'は')];
    const learnerWords = [word(0, 0.05, 'は')];
    const referencePitch = payload([
      { timeSeconds: 0.01, hz: 150, voiced: true, confidence: 1, relativeSemitones: 3 },
    ]);
    const learnerPitch = payload([
      { timeSeconds: 0.01, hz: 150, voiced: true, confidence: 1, relativeSemitones: -3 },
    ]);

    expect(
      buildPitchTimingObservations({ referenceWords, learnerWords, referencePitch, learnerPitch }),
    ).toEqual([]);
  });

  it('translates reference word times by referenceTimeOffsetSeconds (targetRange slicing)', () => {
    // Reference word sits at [2.0, 3.0] in the full clip's time base, but
    // referencePitch was extracted from a targetRange-sliced clip starting
    // at 2.0s, so its frames are time-based from 0.
    const referenceWords = [word(2.0, 3.0, '見に')];
    const learnerWords = [word(0, 1, '見に')];
    const referencePitch = payload(peakFrames(0, 1, 0.2, 5, -2));
    const learnerPitch = payload(peakFrames(0, 1, 0.8, 5, -2));

    const observations = buildPitchTimingObservations({
      referenceWords,
      learnerWords,
      referencePitch,
      learnerPitch,
      referenceTimeOffsetSeconds: 2.0,
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]?.kind).toBe('pitch_timing');
  });
});
