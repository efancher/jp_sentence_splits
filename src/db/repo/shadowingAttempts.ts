import type { Attempt, AttemptRating } from '../../domain/types';
import { getDb } from '../database';
import { createId } from '../../lib/ids';
import { nowIso } from '../../lib/normalize';
import { ANALYSIS_SUMMARY_VERSION } from '../../lib/pronunciationHistory';
import { buildShadowingWeakWords, type ShadowingWeakWord } from '../../lib/pronunciationProfile';

// ---------------------------------------------------------------------------
// Shadowing attempts (docs/UNIFIED_APP_ARCHITECTURE.md §12, Phase 3) —
// local-only, no sync wiring by design (§18). Do not call
// notifySync/notifySyncMany here.
// ---------------------------------------------------------------------------

export async function saveAttempt(input: {
  sentenceId: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  notes?: string;
  referencePlaybackRate?: number;
  practiceStage?: 'final';
  practiceSessionId?: string;
}): Promise<Attempt> {
  const db = getDb();
  const attempt: Attempt = {
    id: createId('attempt'),
    sentenceId: input.sentenceId,
    mimeType: input.mimeType,
    durationMs: input.durationMs,
    blob: input.blob,
    notes: input.notes,
    referencePlaybackRate: input.referencePlaybackRate,
    practiceStage: input.practiceStage,
    practiceSessionId: input.practiceSessionId,
    createdAt: nowIso(),
  };
  await db.attempts.add(attempt);
  return attempt;
}

export async function listAttemptsForSentence(
  sentenceId: string,
): Promise<Attempt[]> {
  const db = getDb();
  const attempts = await db.attempts.where('sentenceId').equals(sentenceId).toArray();
  return attempts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * How many shadowing attempts exist per sentence, for a batch of sentence ids
 * — the session runner uses this to keep each shadow step's subtitle honest
 * (the planner only writes `step.reason` once, at plan time). Counts every
 * attempt row, matching `findShadowCandidates`' own ordering signal.
 */
export async function countAttemptsForSentences(
  sentenceIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (sentenceIds.length === 0) return counts;
  const db = getDb();
  const attempts = await db.attempts.where('sentenceId').anyOf(sentenceIds).toArray();
  for (const attempt of attempts) {
    counts.set(attempt.sentenceId, (counts.get(attempt.sentenceId) ?? 0) + 1);
  }
  return counts;
}

export async function deleteAttempt(attemptId: string): Promise<void> {
  const db = getDb();
  await db.attempts.delete(attemptId);
}

export async function rateAttempt(
  attemptId: string,
  rating: AttemptRating,
): Promise<Attempt> {
  const db = getDb();
  await db.attempts.update(attemptId, { manualRating: rating });
  const attempt = await db.attempts.get(attemptId);
  if (!attempt) throw new Error('Attempt not found');
  return attempt;
}

export async function setAttemptFavorite(
  attemptId: string,
  isFavorite: boolean,
): Promise<Attempt> {
  const db = getDb();
  await db.attempts.update(attemptId, { isFavorite });
  const attempt = await db.attempts.get(attemptId);
  if (!attempt) throw new Error('Attempt not found');
  return attempt;
}


/**
 * Cross-attempt "weak words" (`buildShadowingWeakWords`) — surface forms
 * flagged with a per-word pitch-accent mismatch in more than one analyzed
 * shadowing attempt. Read-only; feeds the `/progress` "What to work on"
 * pronunciation block. Version-filtered like `getPronunciationProfile`.
 */
export async function getShadowingWeakWords(
  options: { minAttempts?: number } = {},
): Promise<ShadowingWeakWord[]> {
  const db = getDb();
  const rows = (await db.attemptAnalysisSummaries.toArray()).filter(
    (row) => row.analysisSummaryVersion === ANALYSIS_SUMMARY_VERSION,
  );
  return buildShadowingWeakWords(
    rows.map((row) => ({ createdAt: row.createdAt, wordIssues: row.wordIssues })),
    options,
  );
}
