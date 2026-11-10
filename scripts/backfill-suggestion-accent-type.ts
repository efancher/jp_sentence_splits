/**
 * Stamps UniDic's `accentType` onto already-stored `sentences.vocabulary_suggestions`
 * (suggestionFromToken only records it for sentences mined after 2026-11-10).
 * It annotates in place: each suggestion keeps its id, span, reading and
 * `selectedByDefault`; only a missing `accentType` is added, and only when the
 * mining server's tokenizer (`POST /resegment`, annotate-only) returns a token
 * with the same span and surface and a usable plain-integer aType (not a
 * proper noun). Sentences already carrying the field are left alone, so the
 * run is idempotent.
 *
 * Dry-run by default; --apply writes. Usage:
 *   npm run backfill:suggestion-accent-type -- [--apply] [--limit N]
 * Override the server with MINING_API_BASE.
 */
import { vocabularySuggestionSchema } from '../src/domain/schemas';
import type { VocabularySuggestion } from '../src/domain/types';

import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const API_BASE = (process.env.MINING_API_BASE ??
  'https://codex-dev.tailfbd89c.ts.net/youtube-mining').replace(/\/$/, '');
const BATCH = 40;

export interface AccentToken {
  surface: string;
  start: number;
  end: number;
  pos?: string;
  accentType?: string;
}

/** Server offsets are code points; stored suggestion spans are UTF-16 units. */
function toUtf16Offsets(text: string): number[] {
  const offsets = [0];
  let utf16 = 0;
  for (const char of text) {
    utf16 += char.length;
    offsets.push(utf16);
  }
  return offsets;
}

/**
 * The suggestions with `accentType` added where a matching token supplies one,
 * or null when nothing changes.
 */
export function annotateAccentTypes(
  japanese: string,
  suggestions: VocabularySuggestion[],
  tokens: AccentToken[],
): VocabularySuggestion[] | null {
  const offsets = toUtf16Offsets(japanese);
  const bySpan = new Map<string, AccentToken>();
  for (const token of tokens) {
    const start = offsets[token.start] ?? token.start;
    const end = offsets[token.end] ?? token.end;
    bySpan.set(`${start}:${end}:${token.surface}`, token);
  }
  let changed = false;
  const next = suggestions.map((suggestion) => {
    if (suggestion.accentType !== undefined || suggestion.source !== 'morphology') return suggestion;
    const token = bySpan.get(`${suggestion.start}:${suggestion.end}:${suggestion.surface}`);
    if (!token || !/^\d+$/.test(token.accentType ?? '')) return suggestion;
    if ((token.pos ?? '').startsWith('名詞/固有名詞')) return suggestion;
    changed = true;
    return { ...suggestion, accentType: Number(token.accentType) };
  });
  return changed ? next : null;
}

async function tokenize(sentences: string[]): Promise<AccentToken[][]> {
  const response = await fetch(`${API_BASE}/resegment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sentences: sentences.map((japanese) => ({ japanese, startMs: 0, endMs: 0 })),
      merge: false,
      split: false,
      generateKana: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`/resegment -> ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const cues = (await response.json()) as Array<{ japanese: string; tokens: AccentToken[] | null }>;
  // annotate-only: one cue per input, in order; refuse a response that re-split anything.
  if (cues.length !== sentences.length || cues.some((cue, i) => cue.japanese !== sentences[i])) {
    throw new Error('/resegment changed the sentence list; refusing to map tokens back.');
  }
  return cues.map((cue) => cue.tokens ?? []);
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const limitArg = argv[argv.indexOf('--limit') + 1];
  const limit = argv.includes('--limit') && limitArg ? Number(limitArg) : Infinity;

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const all = await fetchAll(
    supabase,
    'sentences',
    'id, japanese, vocabulary_suggestions',
    user.id,
    (row) => ({
      id: String(row.id),
      japanese: String(row.japanese ?? ''),
      suggestions: ((row.vocabulary_suggestions as VocabularySuggestion[] | null) ?? []),
    }),
  );
  const todo = all
    .filter((s) => s.japanese.trim() && s.suggestions.some((g) => g.source === 'morphology' && g.accentType === undefined))
    .slice(0, limit === Infinity ? undefined : limit);
  console.log(`${todo.length} sentence(s) with suggestions lacking accentType.\n`);

  let updated = 0;
  let stamped = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const tokens = await tokenize(batch.map((s) => s.japanese));
    for (let j = 0; j < batch.length; j += 1) {
      const sentence = batch[j]!;
      const next = annotateAccentTypes(sentence.japanese, sentence.suggestions, tokens[j] ?? []);
      if (!next) continue;
      for (const suggestion of next) vocabularySuggestionSchema.parse(suggestion);
      const added = next.filter((g, k) => g.accentType !== sentence.suggestions[k]?.accentType).length;
      updated += 1;
      stamped += added;
      if (apply) {
        const { error } = await supabase
          .from('sentences')
          .update({ vocabulary_suggestions: next })
          .eq('id', sentence.id);
        if (error) throw new Error(`update ${sentence.id}: ${error.message}`);
      }
    }
  }

  console.log(
    `Done. ${updated} sentence(s) ${apply ? 'updated' : 'would be updated'} ` +
      `(${stamped} suggestion(s) stamped).`,
  );
  if (!apply) console.log('Dry run — re-run with --apply to write.');
}

if (process.argv[1]?.endsWith('backfill-suggestion-accent-type.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
