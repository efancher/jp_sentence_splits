import { listWordBoundaryLabels, markWordBoundaryLabelsUploaded } from '../db/wordBoundaryLabels';

import { syncLog } from './logger';
import { getSupabase } from './supabaseClient';

/**
 * Best-effort upload of hand-labelled word boundaries to the
 * `word_boundary_labels` table (supabase/migrations/20260920000000). Direct
 * Supabase access, not the sync-event engine — same treatment as
 * `alignmentRemote.ts`. Never throws: labels live locally first, so an
 * unreachable Supabase or a table that hasn't been created yet just leaves them
 * pending.
 */

export type LabelUploadResult =
  | { status: 'ok'; uploaded: number; pending: number }
  | { status: 'table-missing'; pending: number }
  | { status: 'unavailable'; pending: number; message?: string };

/** PostgREST's "relation doesn't exist" surfaces as PGRST205 / 42P01 / a schema-cache message. */
function isMissingTable(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /schema cache|does not exist|could not find the table/i.test(error.message ?? '')
  );
}

export async function uploadPendingWordBoundaryLabels(chunkSize = 50): Promise<LabelUploadResult> {
  const pending = (await listWordBoundaryLabels()).filter((l) => !l.uploadedAt);
  if (pending.length === 0) return { status: 'ok', uploaded: 0, pending: 0 };
  const supabase = getSupabase();
  if (!supabase) return { status: 'unavailable', pending: pending.length };
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const ownerId = session?.user?.id;
    if (!ownerId) return { status: 'unavailable', pending: pending.length, message: 'Not signed in' };

    let uploaded = 0;
    for (let i = 0; i < pending.length; i += chunkSize) {
      const chunk = pending.slice(i, i + chunkSize);
      const { error } = await supabase.from('word_boundary_labels').upsert(
        chunk.map((label) => ({
          id: label.id,
          owner_id: ownerId,
          sentence_vocabulary_id: label.sentenceVocabularyId,
          sentence_audio_id: label.sentenceAudioId,
          verdict: label.verdict,
          sample_kind: label.sampleKind,
          span_version: label.spanVersion,
          payload: label,
          created_at: label.createdAt,
        })),
        { onConflict: 'id' },
      );
      if (error) {
        syncLog('debug', `word_boundary_labels upsert failed: ${error.message}`, 'LABEL_UPLOAD');
        return isMissingTable(error)
          ? { status: 'table-missing', pending: pending.length - uploaded }
          : { status: 'unavailable', pending: pending.length - uploaded, message: error.message };
      }
      await markWordBoundaryLabelsUploaded(chunk.map((l) => l.id));
      uploaded += chunk.length;
    }
    return { status: 'ok', uploaded, pending: 0 };
  } catch (err) {
    return { status: 'unavailable', pending: pending.length, message: (err as Error).message };
  }
}
