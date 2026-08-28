import { getSupabase } from '../sync/supabaseClient';
import { syncLog } from '../sync/logger';

/**
 * Client wrapper for the `vocab-assist` Edge Function — AI-assisted
 * vocabulary glossing. Mirrors `grammarAssist.ts`: never throws for "AI
 * unavailable" reasons (signed out, no Supabase configured, network/server
 * error) — callers get a typed unavailable result and degrade gracefully
 * (the "Meaning (optional)" field simply stays blank, exactly as before this
 * feature existed). AI output is always a suggestion; nothing here writes to
 * Dexie/Supabase.
 */

export interface VocabGlossWord {
  expression: string;
  reading?: string;
  surface?: string;
}

export interface VocabGlossResult {
  expression: string;
  reading: string;
  meaning: string;
  partOfSpeech?: string;
  confidence: number;
}

export type VocabAssistResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

async function invokeVocabAssist<T>(
  body: Record<string, unknown>,
): Promise<VocabAssistResult<T>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, reason: 'Sync is not configured on this device.' };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return { ok: false, reason: 'Sign in to use AI-assisted glossing.' };

  try {
    const { data, error } = await supabase.functions.invoke('vocab-assist', { body });
    if (error) {
      syncLog('warn', error.message, 'VOCAB_ASSIST');
      return { ok: false, reason: 'Vocabulary AI is unavailable right now.' };
    }
    if (!data || typeof data !== 'object' || 'error' in data) {
      const message = (data as { error?: string } | undefined)?.error ?? 'Unknown error';
      syncLog('warn', message, 'VOCAB_ASSIST');
      return { ok: false, reason: 'Vocabulary AI is unavailable right now.' };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    syncLog('warn', err instanceof Error ? err.message : String(err), 'VOCAB_ASSIST');
    return { ok: false, reason: 'Vocabulary AI is unavailable right now.' };
  }
}

/**
 * Gloss `words` (dictionary form + reading) as used in `sentence`. One entry
 * back per input word, echoing expression/reading unchanged.
 */
export async function glossVocabulary(input: {
  sentence: string;
  words: VocabGlossWord[];
}): Promise<VocabAssistResult<{ glosses: VocabGlossResult[] }>> {
  if (!input.sentence.trim() || input.words.length === 0) {
    return { ok: false, reason: 'Nothing to gloss.' };
  }
  return invokeVocabAssist({
    action: 'gloss',
    sentence: input.sentence,
    words: input.words.map((w) => ({
      expression: w.expression,
      reading: w.reading ?? '',
      surface: w.surface ?? '',
    })),
  });
}
