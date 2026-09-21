import type { AlignmentResult } from '../domain/types';
import type { PitchAccentTarget } from '../lib/pitchAccentObservations';
import type { PitchAnalysisPayload } from '../lib/pitch';

import { syncLog } from './logger';
import { getSupabase } from './supabaseClient';

/**
 * Keeps each pitch-drill take in Supabase (`pitch_drill_takes` row + a private
 * `drill-takes` audio object) so the grader can be replayed against real
 * takes and judged against the learner's own after-take labels — see the
 * migration `20260921000000_pitch_drill_takes.sql`.
 *
 * Direct access, not the sync-event engine, and no local mirror: same
 * treatment as `alignmentRemote.ts` / the reference-audio blobs. Best-effort by
 * design — a failed upload never affects the drill, it only means that take
 * isn't kept. Nothing here throws.
 */

/** Which grading logic produced a take's stored `results`; bump when it changes materially. */
export const DRILL_GRADER_VERSION = 'fit-rescue-flat-v2';

export type DrillTakeLabel = 'right' | 'off';
export type DrillTakeLabels = Record<string, DrillTakeLabel>;

export interface DrillTakeTarget extends PitchAccentTarget {
  vocabularyItemId?: string;
  contextSentenceId: string;
}

export interface DrillTakeResult {
  surfaceForm: string;
  measured: boolean;
  mismatch: boolean;
  confidence?: 'low' | 'medium' | 'high';
  expectedShape?: string;
  measuredShape?: string;
  /** The take's pitch barely moved (`FLAT_CONTRAST_SEMITONES`). */
  flat?: boolean;
}

export interface DrillTakeInput {
  id: string;
  ownerId: string;
  mode: 'sentence' | 'word';
  transcript: string;
  focusTriggered: boolean;
  audio: { blob: Blob; mimeType: string; durationMs?: number };
  alignment?: AlignmentResult;
  pitch?: PitchAnalysisPayload;
  targets: DrillTakeTarget[];
  results: DrillTakeResult[];
}

const round = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** The pitch payload with numbers rounded to what the DSP can honestly claim (a 3 s take is ~300 frames). */
export function compactPitch(pitch: PitchAnalysisPayload): PitchAnalysisPayload {
  return {
    ...pitch,
    medianHz: pitch.medianHz === null ? null : round(pitch.medianHz, 1),
    voicedRatio: round(pitch.voicedRatio, 3),
    durationSeconds: round(pitch.durationSeconds, 3),
    frames: pitch.frames.map((frame) => ({
      ...frame,
      timeSeconds: round(frame.timeSeconds, 3),
      hz: frame.hz === null ? null : round(frame.hz, 1),
      confidence: round(frame.confidence, 2),
      relativeSemitones: frame.relativeSemitones === null ? null : round(frame.relativeSemitones, 2),
    })),
  };
}

/** `audio/webm;codecs=opus` → `audio/webm` (the bucket's allow-list compares the bare type). */
export function baseMimeType(mimeType: string): string {
  return mimeType.split(';')[0]!.trim().toLowerCase();
}

function extensionFor(mimeType: string): string {
  const base = baseMimeType(mimeType);
  if (base.includes('webm')) return 'webm';
  if (base.includes('ogg') || base.includes('opus')) return 'ogg';
  if (base.includes('mpeg')) return 'mp3';
  if (base.includes('wav')) return 'wav';
  return 'm4a';
}

export function drillTakeStoragePath(ownerId: string, takeId: string, mimeType: string): string {
  return `${ownerId}/${takeId}.${extensionFor(mimeType)}`;
}

/** The `pitch_drill_takes` row for a take (pure — exported for tests). */
export function buildDrillTakeRow(input: DrillTakeInput, audioPath: string | null) {
  return {
    id: input.id,
    owner_id: input.ownerId,
    mode: input.mode,
    transcript: input.transcript,
    focus_triggered: input.focusTriggered,
    audio_path: audioPath,
    mime_type: baseMimeType(input.audio.mimeType),
    duration_ms: input.audio.durationMs === undefined ? null : Math.round(input.audio.durationMs),
    alignment: input.alignment ?? null,
    pitch: input.pitch ? compactPitch(input.pitch) : null,
    targets: input.targets,
    results: input.results,
    grader: DRILL_GRADER_VERSION,
  };
}

/**
 * Uploads the take's audio, then its row. The row is written even when the
 * audio upload fails (the alignment + pitch are what replay needs; `audio_path`
 * is just null). Resolves true when the row landed.
 */
export async function uploadDrillTake(input: Omit<DrillTakeInput, 'ownerId'>): Promise<boolean> {
  try {
    const supabase = getSupabase();
    if (!supabase) return false;
    const { data } = await supabase.auth.getSession();
    const ownerId = data.session?.user.id;
    if (!ownerId) return false;
    const full: DrillTakeInput = { ...input, ownerId };

    let audioPath: string | null = drillTakeStoragePath(ownerId, input.id, input.audio.mimeType);
    const { error: audioError } = await supabase.storage
      .from('drill-takes')
      .upload(audioPath, input.audio.blob, { contentType: baseMimeType(input.audio.mimeType), upsert: true });
    if (audioError) {
      syncLog('warn', `Drill take audio not kept: ${audioError.message}`, 'DRILL_TAKE_AUDIO');
      audioPath = null;
    }

    const { error } = await supabase.from('pitch_drill_takes').upsert(buildDrillTakeRow(full, audioPath));
    if (error) {
      syncLog('warn', `Drill take not kept: ${error.message}`, 'DRILL_TAKE_ROW');
      return false;
    }
    return true;
  } catch (error) {
    syncLog('warn', `Drill take not kept: ${error instanceof Error ? error.message : String(error)}`, 'DRILL_TAKE_ROW');
    return false;
  }
}

/** Saves the learner's after-take verdicts for a take's words. Resolves true on success. */
export async function saveDrillTakeLabels(takeId: string, labels: DrillTakeLabels): Promise<boolean> {
  try {
    const supabase = getSupabase();
    if (!supabase) return false;
    const { error } = await supabase.from('pitch_drill_takes').update({ labels }).eq('id', takeId);
    if (error) {
      syncLog('warn', `Drill take labels not saved: ${error.message}`, 'DRILL_TAKE_LABELS');
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
