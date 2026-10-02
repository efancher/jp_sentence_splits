import { getSupabase } from '../sync/supabaseClient';
import { syncLog } from '../sync/logger';

/**
 * Client wrapper for the `meaning-assist` Edge Function — AI-written wrong
 * meanings for the sentence-led "pick the English meaning" review. Mirrors
 * `vocabAssist.ts`: never throws for "AI unavailable" reasons, callers get a
 * typed unavailable result and fall back to the copy/paste batch flow.
 * Nothing here writes to Dexie; the caller validates and saves.
 */

export interface MeaningAssistItem {
  id: string;
  japanese: string;
  context: readonly string[];
  correct?: string;
  existing?: readonly string[];
}

export interface MeaningAssistResult {
  id: string;
  correct: string;
  wrong: string[];
}

export type MeaningAssistResponse =
  | { ok: true; items: MeaningAssistResult[] }
  | { ok: false; reason: string };

// Mirrors MAX_ITEMS in supabase/functions/meaning-assist/index.ts.
export const MEANING_ASSIST_MAX_ITEMS_PER_CALL = 10;

export async function generateMeaningBanks(items: MeaningAssistItem[]): Promise<MeaningAssistResponse> {
  if (items.length === 0) return { ok: true, items: [] };
  if (items.length > MEANING_ASSIST_MAX_ITEMS_PER_CALL) {
    return { ok: false, reason: 'Too many sentences for one call.' };
  }
  const supabase = getSupabase();
  if (!supabase) return { ok: false, reason: 'Sync is not configured on this device.' };
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return { ok: false, reason: 'Sign in to use AI-generated meaning choices.' };
  try {
    const { data, error } = await supabase.functions.invoke('meaning-assist', { body: { items } });
    if (error) {
      syncLog('warn', error.message, 'MEANING_ASSIST');
      return { ok: false, reason: 'Meaning AI is unavailable right now.' };
    }
    const results = (data as { items?: unknown } | undefined)?.items;
    if (!Array.isArray(results)) {
      syncLog('warn', (data as { error?: string } | undefined)?.error ?? 'bad response', 'MEANING_ASSIST');
      return { ok: false, reason: 'Meaning AI is unavailable right now.' };
    }
    const sent = new Set(items.map((item) => item.id));
    const clean = results.flatMap((entry): MeaningAssistResult[] => {
      const e = entry as Partial<MeaningAssistResult>;
      if (typeof e.id !== 'string' || !sent.has(e.id) || typeof e.correct !== 'string') return [];
      const wrong = Array.isArray(e.wrong) ? e.wrong.filter((w): w is string => typeof w === 'string') : [];
      return [{ id: e.id, correct: e.correct, wrong }];
    });
    return { ok: true, items: clean };
  } catch (err) {
    syncLog('warn', err instanceof Error ? err.message : String(err), 'MEANING_ASSIST');
    return { ok: false, reason: 'Meaning AI is unavailable right now.' };
  }
}
