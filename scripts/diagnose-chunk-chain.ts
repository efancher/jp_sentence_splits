/**
 * Read-only eligibility diagnostic for chunk-chain shadowing (docs/ROADMAP.md, "Phrase shadowing").
 * Runs the Ear Tiles bunsetsu chunker over every sentence that has a native clip and prints how many
 * chunks they yield, so the minimum chain length can be chosen against real data. Nothing is written.
 *
 * Usage: npm run diagnose:chunk-chain [-- --since 2026-11-01] [--book <bookId>]
 *   --since  only sentences created on/after this date (the "recently imported" check)
 *   --book   only sentences linked to this book through reference_audio
 * It then plans the duration-sized rungs (`planChunkChain`) against each stored alignment and reports the
 * rung-count histogram and rejection reasons. Sentences whose stored tokens don't tile the text (or that have none) are reported as "unchunkable",
 * never counted as zero chunks; they would fall back to whole-sentence shadowing.
 */
import type { Sentence, WordAlignment } from '../src/domain/types';
import { planChunkChain } from '../src/lib/chunkChain';
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

const ALIGNMENT_PAGE_SIZE = 200;

/** `reference_alignment` has no `deleted_at` and its id is the clip's `reference_audio.id`, so it can't use `fetchAll`. */
async function fetchAlignments(
  client: Awaited<ReturnType<typeof createScriptSupabaseClient>>,
  ownerId: string,
): Promise<Map<string, WordAlignment[]>> {
  const out = new Map<string, WordAlignment[]>();
  for (let from = 0; ; from += ALIGNMENT_PAGE_SIZE) {
    const { data, error } = await client
      .from('reference_alignment')
      .select('id,alignment')
      .eq('owner_id', ownerId)
      .order('id', { ascending: true })
      .range(from, from + ALIGNMENT_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to fetch reference_alignment: ${error.message}`);
    for (const row of data ?? []) out.set(row.id as string, ((row.alignment as { words?: WordAlignment[] })?.words ?? []));
    if (!data || data.length < ALIGNMENT_PAGE_SIZE) return out;
  }
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

  const alignments = await fetchAlignments(client, ownerId);
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
  const rungCounts: number[] = [];
  const rejections = new Map<string, number>();
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
    const words = alignments.get(clipBySentence.get(row.id)!.id as string);
    if (!words) {
      rejections.set('no-alignment', (rejections.get('no-alignment') ?? 0) + 1);
    } else {
      const plan = planChunkChain(
        { japanese: row.japanese, vocabularySuggestions: row.vocabulary_suggestions ?? [] } as Pick<Sentence, 'japanese' | 'vocabularySuggestions'>,
        words,
      );
      if (plan.rejection) rejections.set(plan.rejection, (rejections.get(plan.rejection) ?? 0) + 1);
      else rungCounts.push(plan.rungs.length);
    }
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
  console.log(`Planned chains (duration-sized rungs, whole sentence included): ${rungCounts.length} (${pct(rungCounts.length)})`);
  console.log(`  rung count histogram: ${histogram(rungCounts, 6)}`);
  for (const [reason, n] of [...rejections].sort((a, b) => b[1] - a[1])) console.log(`  not planned, ${reason}: ${n} (${pct(n)})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
