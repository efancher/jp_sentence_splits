import {
  getAttemptAlignment,
  getReferenceAlignment,
  saveAttemptAlignment,
  saveReferenceAlignment,
  setAttemptPhraseSnapshot,
} from '../db/repository';
import type { Attempt, AttemptAnalysisSummary } from '../domain/types';

import { loadOrComputeAlignment } from './alignmentCache';
import { toPhraseSnapshot } from './attemptPitchGrid';
import { extractPitch } from './pitch';
import { buildPhrasePitch } from './phrasePitch';
import { canonicalizeAudioBuffer, decodeAudioBuffer } from './waveform';

export interface PhraseSnapshotBackfillResult {
  saved: number;
  /** Alignment unavailable, audio unreadable, or the recording could not be lined up mora by mora. */
  skipped: number;
}

/** Analysed attempts that predate phrase snapshots — only those with a saved summary are touched. */
export function attemptsNeedingPhraseSnapshot(
  attempts: readonly Attempt[],
  summaries: readonly AttemptAnalysisSummary[],
): Attempt[] {
  const missing = new Set(summaries.filter((s) => !s.phraseSnapshot).map((s) => s.id));
  return attempts.filter((a) => missing.has(a.id));
}

/**
 * Re-derives and stores the phrase-pitch snapshot for older attempts without opening each
 * Analyze panel. Uses the whole reference clip (no practice-target slice — that is page state,
 * not stored per attempt) and the cached alignments, so it only calls the alignment service for
 * what was never aligned. One attempt at a time: decoding and pitch extraction are heavy.
 */
export async function backfillPhraseSnapshots({
  transcript,
  referenceAudioId,
  referenceBlob,
  attempts,
  onProgress,
}: {
  transcript: string;
  referenceAudioId: string;
  referenceBlob: Blob;
  attempts: readonly Attempt[];
  onProgress?: (done: number, total: number) => void;
}): Promise<PhraseSnapshotBackfillResult> {
  const result: PhraseSnapshotBackfillResult = { saved: 0, skipped: 0 };
  if (attempts.length === 0) return result;

  let referencePitch;
  try {
    referencePitch = extractPitch(canonicalizeAudioBuffer(await decodeAudioBuffer(referenceBlob)));
  } catch {
    return { saved: 0, skipped: attempts.length };
  }
  const referenceAlignment = await loadOrComputeAlignment(
    referenceAudioId,
    referenceBlob,
    transcript,
    getReferenceAlignment,
    saveReferenceAlignment,
  );

  let done = 0;
  for (const attempt of attempts) {
    try {
      const learnerAlignment = referenceAlignment
        ? await loadOrComputeAlignment(attempt.id, attempt.blob, transcript, getAttemptAlignment, saveAttemptAlignment)
        : undefined;
      if (!referenceAlignment || !learnerAlignment) throw new Error('no alignment');
      const learnerPitch = extractPitch(canonicalizeAudioBuffer(await decodeAudioBuffer(attempt.blob)));
      const phrasePitch = buildPhrasePitch({
        reference: { words: referenceAlignment.words, pitch: referencePitch },
        learner: { words: learnerAlignment.words, pitch: learnerPitch },
      });
      const snapshot = phrasePitch.learnerUnavailable ? undefined : toPhraseSnapshot(phrasePitch);
      if (snapshot && (await setAttemptPhraseSnapshot(attempt.id, snapshot))) result.saved += 1;
      else result.skipped += 1;
    } catch {
      result.skipped += 1;
    }
    done += 1;
    onProgress?.(done, attempts.length);
  }
  return result;
}
