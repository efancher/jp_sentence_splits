/**
 * Restore kanji in sentences whose stored text came through all-kana (Whisper
 * on slow learner speech, before /transcribe-source gained `hotwords`), keeping
 * every id so progress, cards and events stay attached.
 *
 * Edits are explicit substitutions in a JSON file (scripts/data/restore-kanji-*.json),
 * not a re-transcription, so punctuation and wording stay as the learner left
 * them. For each sentence it rewrites `japanese`/`normalized_key`, regenerates
 * `reading_only`/`inline_reading`/`vocabulary_suggestions` from the mining
 * API's annotate-only /resegment, and remaps `sentence_grammar` offsets.
 * `japanese` edits are normally off-limits (see updateSentenceText), so it
 * refuses a sentence that already has a chunk analysis, vocabulary
 * selections/grammar suggestions or sentence_vocabulary links, whose offsets it
 * does not remap. Particle checks are kept when their chunk text survives.
 *
 * Bundled clause questions match on the exact source string; update
 * src/data/activeClauseQuestions.json separately.
 *
 * Dry-run by default; --apply writes. Needs the mining API (MINING_API_BASE,
 * default http://127.0.0.1:8003) and the usual script credentials in .env.
 *
 * Usage: npx tsx scripts/restore-kanji-sentences.ts --edits scripts/data/restore-kanji-2026-11-05.json [--apply]
 */
import { readFileSync } from 'node:fs';

import { vocabularySuggestionSchema } from '../src/domain/schemas';
import { fixNumeralsInReadingOnly } from '../src/lib/fixNumeralReadings';
import { inlineReadingFromTokens } from '../src/lib/inlineReadingFromTokens';
import { normalizeSentenceKey } from '../src/lib/normalize';
import { suggestionsFromTokens, type MorphologyToken } from '../src/lib/vocabularySuggestions';
import { mapOffset, planEdits, type Edit } from './lib/restoreKanji';
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const API_BASE = (process.env.MINING_API_BASE ?? 'http://127.0.0.1:8003').replace(/\/+$/, '');

type Row = Record<string, any>;
type Client = Awaited<ReturnType<typeof createScriptSupabaseClient>>;

interface EditEntry {
  id: string;
  expected: string;
  edits: Edit[];
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function must<T>(label: string, p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${label}: ${error.message}`);
  return (data ?? []) as T;
}

async function annotate(japanese: string): Promise<{ reading: string; tokens: MorphologyToken[] }> {
  const res = await fetch(`${API_BASE}/resegment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sentences: [{ japanese, startMs: 0, endMs: 0 }], merge: false, split: false, generateKana: true }),
  });
  if (!res.ok) throw new Error(`/resegment: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const cue = (await res.json())[0];
  if (!cue || cue.japanese.replace(/\s/g, '') !== japanese.replace(/\s/g, '')) {
    throw new Error(`annotate returned different text for ${japanese}`);
  }
  return { reading: String(cue.reading ?? '').trim(), tokens: cue.tokens ?? [] };
}

interface Planned {
  entry: EditEntry;
  text: string;
  patch: Row;
  grammar: Array<{ id: string; surface: string; start: number; end: number; was: string }>;
}

async function plan(supabase: Client, entry: EditEntry): Promise<Planned> {
  const [sentence] = await must<Row[]>(`sentence ${entry.id}`, supabase.from('sentences').select('*').eq('id', entry.id).is('deleted_at', null));
  if (!sentence) throw new Error(`${entry.id}: not found`);
  if (sentence.japanese !== entry.expected) throw new Error(`${entry.id}: stored text changed ("${sentence.japanese}")`);

  const edited = planEdits(sentence.japanese, entry.edits);

  const [analysis] = await must<Row[]>('analyses', supabase.from('analyses').select('*').eq('sentence_id', entry.id).is('deleted_at', null));
  for (const field of ['chunks', 'vocabulary_selections', 'grammar_suggestions'] as const) {
    if ((analysis?.[field] ?? []).length > 0) throw new Error(`${entry.id}: analyses.${field} is non-empty — offsets not remapped, refusing`);
  }
  for (const check of (analysis?.particle_checks ?? []) as Row[]) {
    if (!edited.text.includes(String(check.chunk))) throw new Error(`${entry.id}: particle check chunk "${check.chunk}" no longer in the text`);
  }
  const links = await must<Row[]>('sentence_vocabulary', supabase.from('sentence_vocabulary').select('id').eq('sentence_id', entry.id).is('deleted_at', null));
  if (links.length > 0) throw new Error(`${entry.id}: has ${links.length} sentence_vocabulary link(s) — refusing`);

  const grammarRows = await must<Row[]>('sentence_grammar', supabase.from('sentence_grammar').select('*').eq('sentence_id', entry.id).is('deleted_at', null));
  const grammar = grammarRows.map((row) => {
    const start = mapOffset(edited.regions, row.start_index);
    const end = mapOffset(edited.regions, row.end_index);
    return { id: row.id as string, surface: edited.text.slice(start, end), start, end, was: row.surface_form as string };
  });

  const { reading, tokens } = await annotate(edited.text);
  const suggestions = suggestionsFromTokens(edited.text, tokens);
  for (const suggestion of suggestions) vocabularySuggestionSchema.parse(suggestion);

  return {
    entry,
    text: edited.text,
    grammar,
    patch: {
      japanese: edited.text,
      normalized_key: normalizeSentenceKey(edited.text),
      reading_only: fixNumeralsInReadingOnly(reading),
      inline_reading: inlineReadingFromTokens(edited.text, tokens),
      vocabulary_suggestions: suggestions,
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const file = arg(argv, '--edits');
  if (!file) throw new Error('--edits <file.json> is required');
  const apply = parseApplyFlag(argv);
  const entries = JSON.parse(readFileSync(file, 'utf8')) as EditEntry[];

  const supabase = await createScriptSupabaseClient();
  await requireAuthedUser(supabase);

  const planned: Planned[] = [];
  for (const entry of entries) planned.push(await plan(supabase, entry));

  for (const p of planned) {
    console.log(`\n${p.entry.id}\n  ${p.entry.expected}\n  -> ${p.text}`);
    console.log(`  reading_only:   ${p.patch.reading_only}`);
    console.log(`  inline_reading: ${p.patch.inline_reading}`);
    console.log(`  suggestions:    ${(p.patch.vocabulary_suggestions as Row[]).map((s) => s.surface).join(' ')}`);
    for (const g of p.grammar) console.log(`  grammar ${g.id}: "${g.was}" -> "${g.surface}" (${g.start}-${g.end})`);
  }

  if (!apply) {
    console.log(`\nDry run — ${planned.length} sentence(s) planned, nothing written. Re-run with --apply to write.`);
    return;
  }
  for (const p of planned) {
    await must(`update ${p.entry.id}`, supabase.from('sentences').update(p.patch).eq('id', p.entry.id).eq('japanese', p.entry.expected).select('id'));
    for (const g of p.grammar) {
      await must(`update grammar ${g.id}`, supabase.from('sentence_grammar').update({ surface_form: g.surface, start_index: g.start, end_index: g.end }).eq('id', g.id).select('id'));
    }
  }
  console.log(`\nApplied ${planned.length} sentence(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
