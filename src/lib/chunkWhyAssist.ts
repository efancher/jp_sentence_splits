import { getSupabase } from '../sync/supabaseClient';
import { syncLog } from '../sync/logger';

/**
 * Client wrapper for the `chunk-why-assist` Edge Function (guided
 * walkthrough "why this role" drafting, 2026-09-28). Mirrors
 * `grammarAssist.ts`'s shape: never throws for "AI unavailable" reasons
 * (signed out, no Supabase configured, network/server error) — callers get
 * a typed unavailable result. Unlike `vocabAssist`/`grammarAssist`, which
 * degrade fully silently on failure, AnalyzePage's walkthrough shows this
 * failure to the learner (a small inline note) rather than hiding it —
 * a deliberate choice for this feature, not a change to the other two.
 */

export interface ChunkWhyContext {
  japanese: string;
  role: string;
  literalEnglish: string;
}

export type ChunkWhyResult =
  | { ok: true; explanation: string }
  | { ok: false; reason: string };

export async function explainChunkWhy(input: {
  sentence: string;
  chunk: ChunkWhyContext;
  /** Every chunk in the sentence, in order, for contrastive context. */
  chunks?: ChunkWhyContext[];
}): Promise<ChunkWhyResult> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, reason: 'Sync is not configured on this device.' };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return { ok: false, reason: 'Sign in to use AI-assisted explanations.' };

  try {
    const { data, error } = await supabase.functions.invoke('chunk-why-assist', {
      body: input,
    });
    if (error) {
      syncLog('warn', error.message, 'CHUNK_WHY_ASSIST');
      return { ok: false, reason: 'AI explanation is unavailable right now.' };
    }
    if (
      !data ||
      typeof data !== 'object' ||
      'error' in data ||
      typeof (data as { explanation?: unknown }).explanation !== 'string'
    ) {
      const message = (data as { error?: string } | undefined)?.error ?? 'Unknown error';
      syncLog('warn', message, 'CHUNK_WHY_ASSIST');
      return { ok: false, reason: 'AI explanation is unavailable right now.' };
    }
    return { ok: true, explanation: (data as { explanation: string }).explanation };
  } catch (err) {
    syncLog('warn', err instanceof Error ? err.message : String(err), 'CHUNK_WHY_ASSIST');
    return { ok: false, reason: 'AI explanation is unavailable right now.' };
  }
}
