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

export async function realignTranslations(
  groups: RealignGroupInput[],
): Promise<RealignResult> {
  const usable = groups.filter((group) => group.pieces.length > 0);
  if (usable.length === 0) return { ok: false, reason: 'Nothing to realign.' };

  const supabase = getSupabase();
  if (!supabase) return { ok: false, reason: 'Sync is not configured on this device.' };
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return { ok: false, reason: 'Sign in to use AI translation help.' };

  try {
    const { data, error } = await supabase.functions.invoke('sentence-realign', {
      body: { action: 'realign', groups: usable },
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
    if (!Array.isArray(resultGroups)) {
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
