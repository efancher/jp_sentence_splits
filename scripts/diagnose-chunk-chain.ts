/**
 * Read-only eligibility diagnostic for chunk-chain shadowing (docs/ROADMAP.md, "Phrase shadowing").
 * Runs the Ear Tiles bunsetsu chunker over every sentence that has a native clip and prints how many
 * chunks they yield, so the minimum chain length can be chosen against real data. Nothing is written.
 *
 * Usage: npm run diagnose:chunk-chain [-- --since 2026-11-01] [--book <bookId>]
 *   --since  only sentences created on/after this date (the "recently imported" check)
 *   --book   only sentences linked to this book through reference_audio
 * Sentences whose stored tokens don't tile the text (or that have none) are reported as "unchunkable",
 * never counted as zero chunks; they would fall back to whole-sentence shadowing.
 */
import type { Sentence } from '../src/domain/types';
import { chunkSentenceIntoTiles } from '../src/lib/earTiles';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function histogram(counts: number[], top: number): string {
  const buckets = new Array<number>(top + 1).fill(0);
  for (const n of counts) buckets[Math.min(n, top)] += 1;
  return buckets.map((n, i) => `${i === top ? `${top}+` : i}:${n}`).join('  ');
}

async function main(): Promise<void> {
  const since = flag('since');
  const book = flag('book');
  const client = await createScriptSupabaseClient();
  const { id: ownerId } = await requireAuthedUser(client);
  const [sentences, audio] = await Promise.all([
    fetchAll<Row>(client, 'sentences', 'id,japanese,vocabulary_suggestions,created_at', ownerId, (r) => r),
    fetchAll<Row>(client, 'reference_audio', 'id,sentence_id,book_id,duration_ms', ownerId, (r) => r),
  ]);

  const clipBySentence = new Map<string, Row>();
  for (const row of audio) {
    if (book && row.book_id !== book) continue;
    clipBySentence.set(row.sentence_id as string, row);
  }

  const scoped = sentences.filter(
    (row) => clipBySentence.has(row.id) && (!since || String(row.created_at) >= since),
  );
  const counts: number[] = [];
  const byLength = new Map<string, number[]>();
  let unchunkable = 0;
  for (const row of scoped) {
    const tiles = chunkSentenceIntoTiles({
      japanese: row.japanese,
      vocabularySuggestions: row.vocabulary_suggestions ?? [],
    } as Pick<Sentence, 'japanese' | 'vocabularySuggestions'>);
    if (!tiles) {
      unchunkable += 1;
      continue;
    }
    counts.push(tiles.length);
    const band = row.japanese.length < 10 ? '<10' : row.japanese.length < 20 ? '10-19' : row.japanese.length < 35 ? '20-34' : '35+';
    byLength.set(band, [...(byLength.get(band) ?? []), tiles.length]);
  }

  const total = scoped.length;
  const pct = (n: number) => (total === 0 ? '0%' : `${Math.round((100 * n) / total)}%`);
  console.log(`Sentences with a native clip${since ? ` created since ${since}` : ''}${book ? ` in ${book}` : ''}: ${total}`);
  console.log(`Unchunkable (no/misaligned tokens): ${unchunkable} (${pct(unchunkable)})`);
  console.log(`Chunk count histogram: ${histogram(counts, 8)}`);
  for (const min of [2, 3, 4]) {
    const n = counts.filter((c) => c >= min).length;
    console.log(`  ${min}+ chunks: ${n} (${pct(n)})`);
  }
  for (const band of ['<10', '10-19', '20-34', '35+']) {
    const rows = byLength.get(band);
    if (!rows) continue;
    const eligible = rows.filter((c) => c >= 3).length;
    console.log(`  length ${band}: ${rows.length} chunkable, ${eligible} with 3+ chunks (${Math.round((100 * eligible) / rows.length)}%)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
