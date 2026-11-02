/**
 * One-off: sentences.vocabulary_suggestions entries for よく/良く (adverb) that
 * carry JMDict's first sense "nicely" get "often, frequently" instead.
 * Dry-run by default; --apply to write. Idempotent.
 *
 * Usage: npx tsx scripts/fix-yoku-suggestion-gloss.ts [--apply]
 */
import type { VocabularySuggestion } from '../src/domain/types';

import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

// Genuine "well" uses (よくやった "well done", よく見られたい "be seen favourably") stay as-is.
const KEEP_SENTENCES = new Set(['sent_4ec33cf9', 'sent_bd8eeb24']);
const NEW_GLOSS = 'often, frequently';

function isStaleYoku(s: VocabularySuggestion): boolean {
  return (
    (s.expression === 'よく' || s.expression === '良く') &&
    s.pos.startsWith('副詞') &&
    /^(nicely|well)\b/i.test(s.english ?? '')
  );
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const rows = await fetchAll(supabase, 'sentences', 'id, japanese, vocabulary_suggestions', user.id, (row) => ({
    id: String(row.id),
    japanese: String(row.japanese),
    suggestions: (row.vocabulary_suggestions as VocabularySuggestion[] | null) ?? [],
  }));
  let n = 0;
  for (const row of rows.filter((r) => !KEEP_SENTENCES.has(r.id) && r.suggestions.some(isStaleYoku))) {
    n += 1;
    console.log(`${row.id}  ${row.japanese}`);
    if (!apply) continue;
    const next = row.suggestions.map((s) => (isStaleYoku(s) ? { ...s, english: NEW_GLOSS } : s));
    const { error } = await supabase.from('sentences').update({ vocabulary_suggestions: next }).eq('id', row.id);
    if (error) throw new Error(`${row.id}: ${error.message}`);
  }
  console.log(`${n} sentence(s) ${apply ? 'updated' : 'would be updated'}.${apply ? '' : ' Dry run — re-run with --apply.'}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
