/**
 * Read-only audit for the grammar-bound lemma list (`GRAMMAR_BOUND_LEMMAS`, src/lib/unknownLemmas.ts): content
 * lemmas that morphology splits out of a fixed pattern (しれる from かもしれない). For each non-noun lemma that
 * appears as a default-checked content word, prints how often it occurs and what text follows/precedes it, plus
 * how often it sits inside text a curated grammar entry detects. A lemma that is (nearly) always inside the same
 * pattern and has no other life is a candidate. Nothing is written.
 *
 * Usage: npm run diagnose:grammar-bound-lemmas [-- --min 5] [--top 60] [--samples 3]
 */
import openJlptGrammar from '../src/data/openJlptGrammar.json';
import type { VocabularySuggestion } from '../src/domain/types';
import { buildGrammarDetector, wordSpansForDetection } from '../src/lib/grammarReference';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main(): Promise<void> {
  const min = Number(flag('min') ?? 5);
  const top = Number(flag('top') ?? 60);
  const samples = Number(flag('samples') ?? 3);
  const client = await createScriptSupabaseClient();
  const { id: ownerId } = await requireAuthedUser(client);
  const sentences = await fetchAll<Row>(client, 'sentences', 'id,japanese,vocabulary_suggestions', ownerId, (r) => r);
  const detect = buildGrammarDetector(openJlptGrammar.patterns as never);

  type Stat = { expression: string; pos: string; count: number; entries: Map<string, number>; contexts: string[] };
  const stats = new Map<string, Stat>();
  for (const sentence of sentences) {
    const japanese: string = sentence.japanese ?? '';
    const suggestions = (sentence.vocabulary_suggestions ?? []) as VocabularySuggestion[];
    const spans = wordSpansForDetection(suggestions);
    const ids = detect(japanese, spans);
    for (const suggestion of suggestions) {
      if (!suggestion.selectedByDefault || suggestion.pos.startsWith('名詞')) continue;
      const key = `${suggestion.expression}|${suggestion.pos}`;
      const stat = stats.get(key) ?? { expression: suggestion.expression, pos: suggestion.pos, count: 0, entries: new Map(), contexts: [] };
      stat.count += 1;
      for (const id of ids) stat.entries.set(id, (stat.entries.get(id) ?? 0) + 1);
      if (stat.contexts.length < samples) {
        stat.contexts.push(`${japanese.slice(Math.max(0, suggestion.start - 6), suggestion.start)}[${japanese.slice(suggestion.start, suggestion.end)}]${japanese.slice(suggestion.end, suggestion.end + 8)}`);
      }
      stats.set(key, stat);
    }
  }
  const rows = [...stats.values()].filter((stat) => stat.count >= min).sort((a, b) => b.count - a.count).slice(0, top);
  console.log(`${sentences.length} sentences; ${stats.size} non-noun lemmas; showing ${rows.length} with >= ${min} occurrences`);
  for (const stat of rows) {
    const common = [...stat.entries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id, n]) => `${id}:${n}`).join(' ');
    console.log(`\n${stat.expression} [${stat.pos}] x${stat.count}  grammar-in-sentence: ${common || '-'}`);
    for (const context of stat.contexts) console.log(`  ${context}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
