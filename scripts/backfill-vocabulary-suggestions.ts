/**
 * Backfills `vocabularySuggestions` for sentences that have none. CSV
 * imports never populate this field (src/lib/csvImport.ts sets it to `[]`);
 * only Shadowmine .zip package imports do (src/lib/shadowingImport.ts) — so
 * every CSV-imported book renders a flat, chip-less vocabulary picker.
 *
 * Tokenization itself is delegated to tokenize_sentences.py, which reuses
 * the same fugashi/UniDic engine (shadowmine.morphology.tokenize_japanese)
 * Shadowmine already uses — no separate/lower-quality tokenizer. Everything
 * downstream of raw tokens (the selectedByDefault/POS-prefix decision,
 * expression/reading normalization) reuses the existing, tested
 * suggestionsFromTokens() rather than duplicating that logic in Python.
 *
 * Dry-run by default; --apply required to write. Idempotent: only
 * sentences with an empty vocabularySuggestions array are selected, so a
 * successful --apply run leaves nothing for the next run to do.
 *
 * Usage: npm run backfill:vocabulary-suggestions -- [--apply]
 * Requires a `shadowmine`-importable Python (see README.md) — override
 * with TOKENIZE_PYTHON_BIN if not plain `python3`.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { vocabularySuggestionSchema } from '../src/domain/schemas';
import {
  suggestionsFromTokens,
  type MorphologyToken,
} from '../src/lib/vocabularySuggestions';

import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const SELECT_PAGE_SIZE = 500;
const PYTHON_BIN = process.env.TOKENIZE_PYTHON_BIN ?? 'python3';
const TOKENIZE_SCRIPT_PATH = fileURLToPath(
  new URL('./tokenize_sentences.py', import.meta.url),
);

interface SentenceRow {
  id: string;
  japanese: string;
}

async function fetchSentencesNeedingTokens(
  supabase: Awaited<ReturnType<typeof createScriptSupabaseClient>>,
  ownerId: string,
): Promise<SentenceRow[]> {
  const rows: SentenceRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('sentences')
      .select('id, japanese, vocabulary_suggestions')
      .eq('owner_id', ownerId)
      .is('deleted_at', null)
      .range(from, from + SELECT_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to fetch sentences: ${error.message}`);
    for (const row of data ?? []) {
      const suggestions = row.vocabulary_suggestions as unknown[] | null;
      const japanese = String(row.japanese ?? '').trim();
      if (Array.isArray(suggestions) && suggestions.length === 0 && japanese) {
        rows.push({ id: String(row.id), japanese });
      }
    }
    if (!data || data.length < SELECT_PAGE_SIZE) break;
    from += SELECT_PAGE_SIZE;
  }
  return rows;
}

/**
 * tokenize_japanese (Python side) reports Unicode code-point offsets
 * (documented in shadowmine/morphology.py), but validateSpan()/.slice() in
 * src/lib/vocabularySuggestions.ts operate on UTF-16 code units. These only
 * diverge for text containing an astral-plane character (surrogate pair —
 * e.g. rare kanji like 𠮟, U+20B9F) before a given token; without this
 * conversion, every token after one would silently fail validateSpan() and
 * get dropped. offsets[i] is the UTF-16 index of code-point index i.
 */
function codePointToUtf16Offsets(text: string): number[] {
  const offsets: number[] = [0];
  let utf16 = 0;
  for (const char of text) {
    utf16 += char.length;
    offsets.push(utf16);
  }
  return offsets;
}

function tokensToUtf16Offsets(
  japanese: string,
  tokens: MorphologyToken[],
): MorphologyToken[] {
  const offsets = codePointToUtf16Offsets(japanese);
  return tokens.map((token) => ({
    ...token,
    start: offsets[token.start] ?? token.start,
    end: offsets[token.end] ?? token.end,
  }));
}

function tokenizeBatch(
  sentences: SentenceRow[],
): Map<string, MorphologyToken[]> {
  if (!sentences.length) return new Map();
  const input = JSON.stringify(
    sentences.map((item) => ({ id: item.id, japanese: item.japanese })),
  );
  const result = spawnSync(PYTHON_BIN, [TOKENIZE_SCRIPT_PATH], {
    input,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
  if (result.error) {
    throw new Error(`Failed to run ${PYTHON_BIN}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `tokenize_sentences.py exited ${result.status}: ${result.stderr}`,
    );
  }
  const parsed = JSON.parse(result.stdout) as Array<{
    id: string;
    tokens: MorphologyToken[];
  }>;
  return new Map(parsed.map((item) => [item.id, item.tokens]));
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  const supabase = await createScriptSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Signed in but no user on session — unexpected.');

  console.log('Fetching sentences with no vocabulary suggestions yet...');
  const sentences = await fetchSentencesNeedingTokens(supabase, user.id);
  console.log(`Found ${sentences.length} sentence(s) to tokenize.`);
  if (!sentences.length) return;

  console.log('Tokenizing...');
  const tokensBySentenceId = tokenizeBatch(sentences);

  let tokenized = 0;
  let skippedNoTokens = 0;
  let skippedInvalid = 0;
  for (const sentence of sentences) {
    const tokens = tokensToUtf16Offsets(
      sentence.japanese,
      tokensBySentenceId.get(sentence.id) ?? [],
    );
    const suggestions = suggestionsFromTokens(sentence.japanese, tokens);
    if (!suggestions.length) {
      skippedNoTokens += 1;
      continue;
    }
    const parsed = suggestions.map((suggestion) =>
      vocabularySuggestionSchema.safeParse(suggestion),
    );
    const invalid = parsed.find((result) => !result.success);
    if (invalid) {
      console.warn(
        `Skipping ${sentence.id}: suggestion failed validation — ${
          invalid.success ? '' : invalid.error.message
        }`,
      );
      skippedInvalid += 1;
      continue;
    }
    tokenized += 1;
    console.log(
      `  ${sentence.id}: ${suggestions.length} suggestion(s) — ${sentence.japanese.slice(0, 30)}`,
    );
    if (apply) {
      const { error } = await supabase
        .from('sentences')
        .update({ vocabulary_suggestions: suggestions })
        .eq('id', sentence.id);
      if (error) {
        throw new Error(
          `Failed to update sentence ${sentence.id}: ${error.message}`,
        );
      }
    }
  }

  console.log(
    `\nDone. ${tokenized} sentence(s) ${apply ? 'updated' : 'would be updated'}, ` +
      `${skippedNoTokens} produced no suggestions, ${skippedInvalid} skipped (invalid).`,
  );
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
