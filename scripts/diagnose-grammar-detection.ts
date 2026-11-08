/**
 * Read-only audit of text-based grammar detection (`buildGrammarDetector`, docs/ROADMAP.md i+1 step 4). For each
 * OpenJLPT entry the detector finds in the learner's sentences, prints how many sentences match and a few
 * contexts with the matched text bracketed, so over-matches (a short pattern hiding inside a longer word)
 * can be spotted and guarded. Nothing is written.
 *
 * Usage: npm run diagnose:grammar-detection [-- --samples 4] [--max-literal 4] [--pattern <id>]
 *   --max-literal  only audit entries whose shortest fixed text is at most this many characters (default 4):
 *                  short literals are where over-matches live.
 */
import openJlptGrammar from '../src/data/openJlptGrammar.json';
import type { VocabularySuggestion } from '../src/domain/types';
import { buildGrammarDetector, detectableSegments, wordSpansForDetection } from '../src/lib/grammarReference';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main(): Promise<void> {
  const samples = Number(flag('samples') ?? 4);
  const maxLiteral = Number(flag('max-literal') ?? 4);
  const only = flag('pattern');
  const client = await createScriptSupabaseClient();
  const { id: ownerId } = await requireAuthedUser(client);
  const sentences = await fetchAll<Row>(client, 'sentences', 'id,japanese,vocabulary_suggestions', ownerId, (r) => r);

  const entries = openJlptGrammar.patterns.filter((entry) => entry.id && (!only || entry.id === only));
  const literalLength = new Map<string, number>();
  for (const entry of entries) {
    const lengths = detectableSegments(entry as never).map((segments) => segments.join('').length);
    if (lengths.length > 0) literalLength.set(entry.id!, Math.min(...lengths));
  }
  const detect = buildGrammarDetector(entries as never);
  const hits = new Map<string, Array<{ id: string; japanese: string }>>();
  for (const sentence of sentences) {
    const japanese: string = sentence.japanese ?? '';
    const words = wordSpansForDetection((sentence.vocabulary_suggestions ?? []) as VocabularySuggestion[]);
    for (const entryId of detect(japanese, words)) {
      const list = hits.get(entryId) ?? [];
      list.push({ id: sentence.id, japanese });
      hits.set(entryId, list);
    }
  }

  const rows = [...hits.entries()]
    .filter(([id]) => (literalLength.get(id) ?? Infinity) <= maxLiteral)
    .sort((a, b) => b[1].length - a[1].length);
  console.log(`${sentences.length} sentences; ${hits.size} entries detected; auditing ${rows.length} with literal <= ${maxLiteral}`);
  for (const [id, list] of rows) {
    const entry = entries.find((candidate) => candidate.id === id)!;
    console.log(`\n${entry.pattern} [${entry.level ?? '?'}] id=${id} literal=${literalLength.get(id)} sentences=${list.length}`);
    for (const sample of list.slice(0, samples)) console.log(`  ${sample.japanese}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
