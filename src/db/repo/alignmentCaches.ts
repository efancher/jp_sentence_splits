// ---------------------------------------------------------------------------
// Cached forced-alignment results (docs/STATUS.md Phase 9, Milestone 2b).
// A stale `alignmentVersion` is treated the same as a cache miss, so callers
// always get either a fresh cached result or nothing — never a stale one.
// The same version-as-cache-key contract covers the reference pitch tracks
// and the per-attempt analysis caches moved here with them.
// ---------------------------------------------------------------------------

import type {
  AlignmentResult,
  AttemptAlignment,
  AttemptAnalysisSummary,
  AttemptTranscription,
  PhraseSnapshotRow,
  ReferenceAlignment,
} from '../../domain/types';
import { ALIGNMENT_VERSION, TRANSCRIPTION_VERSION } from '../../lib/analysisApi';
import { nowIso } from '../../lib/normalize';
import {
  PITCH_TRACK_VERSION,
  type PitchAnalysisPayload,
  type ReferencePitchTrack,
} from '../../lib/pitch';
import { ANALYSIS_SUMMARY_VERSION } from '../../lib/pronunciationHistory';
import { getDb } from '../database';

export async function getReferenceAlignment(
  sentenceAudioId: string,
): Promise<AlignmentResult | undefined> {
  const db = getDb();
  const row = await db.referenceAlignments.get(sentenceAudioId);
  if (!row || row.alignmentVersion !== ALIGNMENT_VERSION) return undefined;
  return row.result;
}

export async function saveReferenceAlignment(
  sentenceAudioId: string,
  result: AlignmentResult,
): Promise<void> {
  const db = getDb();
  const row: ReferenceAlignment = {
    id: sentenceAudioId,
    alignmentVersion: ALIGNMENT_VERSION,
    result,
    computedAt: nowIso(),
  };
  await db.referenceAlignments.put(row);
}

// Measured YIN pitch track of a reference clip — the sentence-level pitch
// overlay's data source. A stale `pitchVersion` reads as a cache miss, same
// contract as `getReferenceAlignment`.

export async function getReferencePitchTrack(
  sentenceAudioId: string,
): Promise<PitchAnalysisPayload | undefined> {
  const db = getDb();
  const row = await db.referencePitchTracks.get(sentenceAudioId);
  if (!row || row.pitchVersion !== PITCH_TRACK_VERSION) return undefined;
  return row.payload;
}

export async function saveReferencePitchTrack(
  sentenceAudioId: string,
  payload: PitchAnalysisPayload,
): Promise<void> {
  const db = getDb();
  const row: ReferencePitchTrack = {
    id: sentenceAudioId,
    pitchVersion: PITCH_TRACK_VERSION,
    payload,
    computedAt: nowIso(),
  };
  await db.referencePitchTracks.put(row);
}

export async function getAttemptAlignment(
  attemptId: string,
): Promise<AlignmentResult | undefined> {
  const db = getDb();
  const row = await db.attemptAlignments.get(attemptId);
  if (!row || row.alignmentVersion !== ALIGNMENT_VERSION) return undefined;
  return row.result;
}

export async function saveAttemptAlignment(
  attemptId: string,
  result: AlignmentResult,
): Promise<void> {
  const db = getDb();
  const row: AttemptAlignment = {
    id: attemptId,
    alignmentVersion: ALIGNMENT_VERSION,
    result,
    computedAt: nowIso(),
  };
  await db.attemptAlignments.put(row);
}

export async function getAttemptTranscription(attemptId: string): Promise<string | undefined> {
  const db = getDb();
  const row = await db.attemptTranscriptions.get(attemptId);
  if (!row || row.transcriptionVersion !== TRANSCRIPTION_VERSION) return undefined;
  return row.text;
}

export async function saveAttemptTranscription(attemptId: string, text: string): Promise<void> {
  const db = getDb();
  const row: AttemptTranscription = {
    id: attemptId,
    transcriptionVersion: TRANSCRIPTION_VERSION,
    text,
    computedAt: nowIso(),
  };
  await db.attemptTranscriptions.put(row);
}

export async function saveAttemptAnalysisSummary(
  summary: Omit<AttemptAnalysisSummary, 'analysisSummaryVersion'>,
): Promise<void> {
  const db = getDb();
  const row: AttemptAnalysisSummary = { ...summary, analysisSummaryVersion: ANALYSIS_SUMMARY_VERSION };
  await db.attemptAnalysisSummaries.put(row);
}

/** Adds a phrase snapshot to an already-saved summary without touching its other fields; false if the summary is gone or stale. */
export async function setAttemptPhraseSnapshot(
  attemptId: string,
  phraseSnapshot: PhraseSnapshotRow[],
): Promise<boolean> {
  const db = getDb();
  const row = await db.attemptAnalysisSummaries.get(attemptId);
  if (!row || row.analysisSummaryVersion !== ANALYSIS_SUMMARY_VERSION) return false;
  await db.attemptAnalysisSummaries.update(attemptId, { phraseSnapshot, phraseSnapshotPitchVersion: PITCH_TRACK_VERSION });
  return true;
}

export async function listAttemptAnalysisSummariesForSentence(
  sentenceId: string,
): Promise<AttemptAnalysisSummary[]> {
  const db = getDb();
  const rows = await db.attemptAnalysisSummaries.where('sentenceId').equals(sentenceId).toArray();
  return rows.filter((row) => row.analysisSummaryVersion === ANALYSIS_SUMMARY_VERSION);
}
