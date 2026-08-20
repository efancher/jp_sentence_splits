import { getSupabase } from '../sync/supabaseClient';
import { syncLog } from '../sync/logger';

/**
 * Client wrapper for the `grammar-assist` Edge Function (grammar-learning
 * system, Phase 4 — see docs/STATUS.md). Mirrors `inviteBookMember`'s
 * shape: never throws for "AI unavailable" reasons (signed out, no
 * Supabase configured, network/server error) — callers get a typed
 * unavailable result and degrade gracefully, same as this app's other
 * network-dependent features (e.g. the forced-alignment service in
 * `analysisApi.ts`). AI output here is always a suggestion; nothing in
 * this module writes to Dexie/Supabase.
 */

export interface GrammarAssistChunkContext {
  japanese: string;
  role: string;
  literalEnglish: string;
}

export interface GrammarSuggestionResult {
  candidateName: string;
  matchedExistingName?: string;
  shortMeaning: string;
  rank: 'important' | 'familiar' | 'nuance' | 'optional';
  confidence: number;
}

export interface GrammarExplanationResult {
  shortMeaning: string;
  structuralNotes: string;
  explanation: string;
}

export type GrammarAssistResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

async function invokeGrammarAssist<T>(
  body: Record<string, unknown>,
): Promise<GrammarAssistResult<T>> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, reason: 'Sync is not configured on this device.' };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return { ok: false, reason: 'Sign in to use AI-assisted grammar.' };

  try {
    const { data, error } = await supabase.functions.invoke('grammar-assist', { body });
    if (error) {
      syncLog('warn', error.message, 'GRAMMAR_ASSIST');
      return { ok: false, reason: 'Grammar AI is unavailable right now.' };
    }
    if (!data || typeof data !== 'object' || 'error' in data) {
      const message = (data as { error?: string } | undefined)?.error ?? 'Unknown error';
      syncLog('warn', message, 'GRAMMAR_ASSIST');
      return { ok: false, reason: 'Grammar AI is unavailable right now.' };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    syncLog('warn', err instanceof Error ? err.message : String(err), 'GRAMMAR_ASSIST');
    return { ok: false, reason: 'Grammar AI is unavailable right now.' };
  }
}

export async function suggestGrammarPatterns(input: {
  sentence: string;
  chunks?: GrammarAssistChunkContext[];
  existingPatternNames?: string[];
}): Promise<GrammarAssistResult<{ patterns: GrammarSuggestionResult[] }>> {
  return invokeGrammarAssist({
    action: 'suggest',
    sentence: input.sentence,
    chunks: input.chunks,
    existingPatternNames: input.existingPatternNames,
  });
}

export async function explainGrammarPattern(input: {
  sentence: string;
  patternName: string;
  chunks?: GrammarAssistChunkContext[];
}): Promise<GrammarAssistResult<GrammarExplanationResult>> {
  return invokeGrammarAssist({
    action: 'explain',
    sentence: input.sentence,
    patternName: input.patternName,
    chunks: input.chunks,
  });
}
