import { getSupabase } from '../sync/supabaseClient';
import { syncLog } from '../sync/logger';

/**
 * Client wrapper for the `sentence-realign` Edge Function — AI redistribution
 * of an existing human translation across a re-segmented sentence's new
 * pieces (`src/pages/ResegmentSourcePage.tsx`). Mirrors `vocabAssist.ts` /
 * `grammarAssist.ts`: never throws for "AI unavailable" reasons — callers
 * get a typed unavailable result and keep the mechanically-seeded
 * translations. Nothing here writes to Dexie/Supabase; output is a
 * suggestion the user still reviews.
 */

export interface RealignGroupInput {
  originalJapanese: string;
  originalTranslation: string;
  pieces: string[];
}

export type RealignResult =
  | { ok: true; groups: { pieceTranslations: string[] }[] }
  | { ok: false; reason: string };

// Mirrors MAX_GROUPS in supabase/functions/sentence-realign/index.ts. The
// mining wizard's "Auto-fill translations (AI)" can hand this a whole
// podcast/video's worth of rows (100+) in one call — chunking here is what
// makes that request actually cover every row instead of the edge function
// silently truncating to its first 60 (2026-09-13 incident: 162 rows, only
// the first 60 got translated, with no error surfaced).
const REALIGN_MAX_GROUPS_PER_CALL = 60;

/**
 * The caller maps `groups[i]`'s result back onto row `i` by plain array
 * position (see `buildMiningRealignGroups`'s `assignments`) — there is no
 * echoed id to re-associate by. A response with the wrong length would
 * therefore silently misassign every group after the discrepancy rather
 * than fail visibly (the same 2026-09-13 incident: one dropped group
 * shifted every later row's translation onto the wrong sentence). Fail
 * loudly on any length mismatch instead of trusting the position.
 */
async function realignBatch(
  groups: RealignGroupInput[],
): Promise<{ ok: true; groups: { pieceTranslations: string[] }[] } | { ok: false; reason: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, reason: 'Sync is not configured on this device.' };
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return { ok: false, reason: 'Sign in to use AI translation help.' };

  try {
    const { data, error } = await supabase.functions.invoke('sentence-realign', {
      body: { action: 'realign', groups },
    });
    if (error) {
      syncLog('warn', error.message, 'SENTENCE_REALIGN');
      return { ok: false, reason: 'Translation AI is unavailable right now.' };
    }
    if (!data || typeof data !== 'object' || 'error' in data) {
      const message = (data as { error?: string } | undefined)?.error ?? 'Unknown error';
      syncLog('warn', message, 'SENTENCE_REALIGN');
      return { ok: false, reason: 'Translation AI is unavailable right now.' };
    }
    const resultGroups = (data as { groups?: unknown }).groups;
    if (!Array.isArray(resultGroups) || resultGroups.length !== groups.length) {
      syncLog(
        'warn',
        `sentence-realign returned ${Array.isArray(resultGroups) ? resultGroups.length : 'a non-array'} ` +
          `group(s) for a request of ${groups.length} — refusing to apply a misaligned result`,
        'SENTENCE_REALIGN',
      );
      return { ok: false, reason: 'Translation AI returned an unexpected response.' };
    }
    return {
      ok: true,
      groups: resultGroups.map((group) => ({
        pieceTranslations: Array.isArray((group as { pieceTranslations?: unknown }).pieceTranslations)
          ? (group as { pieceTranslations: unknown[] }).pieceTranslations.map((piece) =>
              String(piece ?? ''),
            )
          : [],
      })),
    };
  } catch (err) {
    syncLog('warn', err instanceof Error ? err.message : String(err), 'SENTENCE_REALIGN');
    return { ok: false, reason: 'Translation AI is unavailable right now.' };
  }
}

export async function realignTranslations(
  groups: RealignGroupInput[],
): Promise<RealignResult> {
  if (groups.length === 0) return { ok: false, reason: 'Nothing to realign.' };

  const out: { pieceTranslations: string[] }[] = [];
  for (let start = 0; start < groups.length; start += REALIGN_MAX_GROUPS_PER_CALL) {
    const batch = groups.slice(start, start + REALIGN_MAX_GROUPS_PER_CALL);
    const result = await realignBatch(batch);
    if (!result.ok) return result;
    out.push(...result.groups);
  }
  return { ok: true, groups: out };
}
