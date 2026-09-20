import type { WordAlignment } from '../domain/types';

import type { MoraUnit } from './mora';
import type { PitchAnalysisPayload } from './pitch';
import type { PhrasePitchResult } from './phrasePitch';

/**
 * A compact JSON snapshot of everything the phrase pitch panel computed from, for a "Report a problem"
 * on it. The learner's alignment and pitch live only in their browser, so without this a bad phrase can
 * only be guessed at. Deliberately small: word and phone timings (rounded to ms), the resulting rows,
 * and a per-token count of voiced learner pitch frames — no raw audio and no full pitch track.
 */

const round = (n: number) => Math.round(n * 1000) / 1000;

function compactWords(words: readonly WordAlignment[]) {
  return words.map((w) => ({
    text: w.text,
    start: round(w.start),
    end: round(w.end),
    phones: w.phones.map((p) => `${p.text}:${round(p.start)}-${round(p.end)}`),
  }));
}

function voicedFramesPerToken(words: readonly WordAlignment[], pitch: PitchAnalysisPayload, offsetSeconds: number) {
  return words.map((w) => {
    let voiced = 0;
    let total = 0;
    for (const frame of pitch.frames) {
      if (frame.timeSeconds >= w.start - offsetSeconds && frame.timeSeconds < w.end - offsetSeconds) {
        total += 1;
        if (frame.voiced && frame.relativeSemitones !== null) voiced += 1;
      }
    }
    return `${voiced}/${total}`;
  });
}

export function buildPhrasePitchSnapshot({
  sentenceId,
  attemptId,
  japanese,
  moraUnits,
  result,
  reference,
  learner,
}: {
  sentenceId: string;
  attemptId: string;
  japanese: string;
  moraUnits: readonly MoraUnit[];
  result: PhrasePitchResult;
  reference: { words: readonly WordAlignment[]; pitch: PitchAnalysisPayload; pitchOffsetSeconds: number };
  learner?: { words: readonly WordAlignment[]; pitch: PitchAnalysisPayload };
}): string {
  return JSON.stringify({
    kind: 'phrase-pitch',
    sentenceId,
    attemptId,
    japanese,
    moraKana: moraUnits.map((m) => m.text).join(' '),
    result: {
      unavailable: result.unavailable ?? null,
      learnerUnavailable: result.learnerUnavailable,
      learnerUnavailableReason: result.learnerUnavailableReason ?? null,
      learnerApproximateTokens: result.learnerApproximateTokens,
      rows: result.rows.map((r) => ({
        text: r.text,
        kana: r.kana.join(''),
        status: r.status,
        native: r.native.join(''),
        nativeContrast: round(r.nativeContrast),
        nativeLevels: r.nativeLevels.map((l) => (l === null ? null : round(l))),
        learner: r.learner ? r.learner.join('') : null,
        learnerContrast: r.learnerContrast === null ? null : round(r.learnerContrast),
        learnerLevels: r.learnerLevels ? r.learnerLevels.map((l) => (l === null ? null : round(l))) : null,
        learnerVoicedMorae: r.learnerVoicedMorae,
      })),
    },
    reference: {
      words: compactWords(reference.words),
      pitchOffsetSeconds: round(reference.pitchOffsetSeconds),
      pitchDurationSeconds: round(reference.pitch.durationSeconds),
      voicedFramesPerToken: voicedFramesPerToken(reference.words, reference.pitch, reference.pitchOffsetSeconds),
    },
    learner: learner
      ? {
          words: compactWords(learner.words),
          pitchDurationSeconds: round(learner.pitch.durationSeconds),
          voicedRatio: round(learner.pitch.voicedRatio),
          voicedFramesPerToken: voicedFramesPerToken(learner.words, learner.pitch, 0),
        }
      : null,
  });
}
