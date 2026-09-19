import type { AlignmentResult } from '../domain/types';
import { ALIGNMENT_VERSION } from '../lib/analysisApi';

import { syncLog } from './logger';
import { getSupabase } from './supabaseClient';

/**
 * Direct Supabase access to the `reference_alignment` cache table — the
 * middle tier of `loadOrComputeAlignment` (local Dexie cache → here → the
 * tailnet-only MFA `/align` service). Lets a client that's off the tailnet
 * still get a word-audio span for any recording whose alignment was
 * computed once (at mining-commit time or by
 * `scripts/backfill-reference-alignment.ts`).
 *
 * Not routed through the sync-event engine on purpose — same treatment as
 * the reference-audio blobs (see `audioSync.ts`): derived, recomputable,
 * owner-scoped. Never throws; an unreachable/misconfigured Supabase is an
 * ordinary "not available" here, exactly like the alignment service itself.
 */

export async function fetchRemoteAlignment(
  sentenceAudioId: string,
): Promise<AlignmentResult | undefined> {
  const supabase = getSupabase();
  if (!supabase) return undefined;
  try {
    const { data, error } = await supabase
      .from('reference_alignment')
      .select('alignment, alignment_version')
      .eq('id', sentenceAudioId)
      .maybeSingle();
    if (error || !data) return undefined;
    if (Number(data.alignment_version) !== ALIGNMENT_VERSION) return undefined;
    const result = data.alignment as AlignmentResult;
    if (!result || !Array.isArray(result.words)) return undefined;
    return result;
  } catch {
    return undefined;
  }
}

/**
 * Bulk variant of `fetchRemoteAlignment` — one `in()` query per chunk instead
 * of a round-trip per recording. For callers that need to know up front which
 * of many clips have a usable alignment (the Odd Ear Out game). Never throws;
 * ids that are missing, stale, or unreachable simply aren't in the result.
 */
export async function fetchRemoteAlignments(
  sentenceAudioIds: readonly string[],
  chunkSize = 40,
): Promise<Map<string, AlignmentResult>> {
  const found = new Map<string, AlignmentResult>();
  const supabase = getSupabase();
  if (!supabase || sentenceAudioIds.length === 0) return found;
  for (let i = 0; i < sentenceAudioIds.length; i += chunkSize) {
    const chunk = sentenceAudioIds.slice(i, i + chunkSize);
    try {
      const { data, error } = await supabase
        .from('reference_alignment')
        .select('id, alignment, alignment_version')
        .in('id', chunk);
      if (error || !data) continue;
      for (const row of data) {
        if (Number(row.alignment_version) !== ALIGNMENT_VERSION) continue;
        const result = row.alignment as AlignmentResult;
        if (result && Array.isArray(result.words)) found.set(row.id as string, result);
      }
    } catch {
      // Best effort — a failed chunk just leaves those clips unresolved.
    }
  }
  return found;
}

export async function uploadRemoteAlignment(
  sentenceAudioId: string,
  result: AlignmentResult,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const ownerId = session?.user?.id;
    if (!ownerId) return;
    const { error } = await supabase.from('reference_alignment').upsert(
      {
        id: sentenceAudioId,
        owner_id: ownerId,
        alignment: result,
        alignment_version: ALIGNMENT_VERSION,
      },
      { onConflict: 'id' },
    );
    if (error) {
      syncLog('debug', `reference_alignment upsert skipped: ${error.message}`, 'ALIGN_UPLOAD');
    }
  } catch {
    // Opportunistic only — a client that can't push just means another
    // device or the backfill script will.
  }
}
