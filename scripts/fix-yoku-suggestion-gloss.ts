/**
 * One-off: corrects sentences.vocabulary_suggestions glosses where JMDict's
 * first sense was the wrong one (よく "nicely", まあ "just", 結構 "splendid",
 * あまり/あんまり "remainder", 好き "liking").
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

/** Glosses JMDict's first sense got wrong (see GLOSS_OVERRIDES in lib/jmdict.ts). */
const STALE: Array<{ expression: string; posPrefix: string; stale: RegExp; gloss: string }> = [
  { expression: 'よく', posPrefix: '副詞', stale: /^(nicely|well)\b/i, gloss: NEW_GLOSS },
  { expression: '良く', posPrefix: '副詞', stale: /^(nicely|well)\b/i, gloss: NEW_GLOSS },
  { expression: 'まあ', posPrefix: '副詞', stale: /^just\b/i, gloss: 'well, I suppose' },
  { expression: '結構', posPrefix: '副詞', stale: /^splendid/i, gloss: 'quite, fairly, considerably' },
  { expression: 'あまり', posPrefix: '副詞', stale: /^remainder/i, gloss: 'not very / not much' },
  { expression: 'あんまり', posPrefix: '副詞', stale: /^remainder/i, gloss: 'not very / not much' },
  { expression: '好き', posPrefix: '形状詞', stale: /^liking$/i, gloss: 'to like / fond of' },
];

function fixedGloss(s: VocabularySuggestion): string | null {
  const rule = STALE.find((r) => r.expression === s.expression && s.pos.startsWith(r.posPrefix));
  return rule && rule.stale.test(s.english ?? '') ? rule.gloss : null;
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
  for (const row of rows.filter((r) => !KEEP_SENTENCES.has(r.id) && r.suggestions.some((x) => fixedGloss(x)))) {
    n += 1;
    console.log(`${row.id}  ${row.japanese}`);
    if (!apply) continue;
    const next = row.suggestions.map((s) => {
      const g = fixedGloss(s); return g ? { ...s, english: g } : s;
    });
    const { error } = await supabase.from('sentences').update({ vocabulary_suggestions: next }).eq('id', row.id);
    if (error) throw new Error(`${row.id}: ${error.message}`);
  }
  console.log(`${n} sentence(s) ${apply ? 'updated' : 'would be updated'}.${apply ? '' : ' Dry run — re-run with --apply.'}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
