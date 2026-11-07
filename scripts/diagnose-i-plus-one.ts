/**
 * Read-only feasibility diagnostic for i+1 sequencing (docs/ROADMAP.md, "organic vocabulary/grammar growth").
 * For every in-book sentence the learner has not been introduced to, counts the content lemmas (morphology
 * suggestions that start checked in the vocab picker) they have not met in an introduced sentence, then prints
 * the distribution, per-book 1-2-unknown pool and the highest unlock-value words. Nothing is written.
 *
 * Usage: npm run diagnose:i-plus-one [-- --top 15] [--book <bookId>]
 *   --book  scope the candidate list to one book (the post-import "ready to pick up" summary); the known set
 *           still comes from every introduced sentence.
 * Untokenized sentences (CSV/Anki imports write [] until backfill:vocabulary-suggestions runs) are reported as
 * not scorable, never counted as zero unknowns.
 * "Introduced" matches getIntroducedSentenceIds: walkthrough_completed, started in a book, or has a sentence card.
 */
import type { VocabularySuggestion } from '../src/domain/types';
import {
  buildKnownLemmaSet,
  lemmaKey,
  lemmaWeight,
  scoreSentence,
  unknownCountHistogram,
  unlockValueByLemma,
} from '../src/lib/unknownLemmas';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function formatHistogram(buckets: number[]): string {
  const last = buckets.length - 1;
  return buckets.map((n, i) => `${i === last ? `${last}+` : i}:${n}`).join('  ');
}

async function main(): Promise<void> {
  const top = Number(flag('top') ?? 15);
  const client = await createScriptSupabaseClient();
  const { id: ownerId } = await requireAuthedUser(client);
  const [bookSentences, events, studyItems, sentences] = await Promise.all([
    fetchAll<Row>(client, 'book_sentences', 'id,book_id,sentence_id,status', ownerId, (r) => r),
    fetchAll<Row>(client, 'sentence_learning_events', 'id,sentence_id,action', ownerId, (r) => r),
    fetchAll<Row>(client, 'study_items', 'id,subject_id,subject_type', ownerId, (r) => r),
    fetchAll<Row>(client, 'sentences', 'id,vocabulary_suggestions', ownerId, (r) => r),
  ]);

  const introduced = new Set<string>();
  for (const e of events) if (e.action === 'walkthrough_completed') introduced.add(e.sentence_id);
  for (const b of bookSentences) if (b.status !== 'unstarted') introduced.add(b.sentence_id);
  for (const i of studyItems) if (i.subject_type === 'sentence') introduced.add(i.subject_id);

  const suggestionsBySentence = new Map<string, VocabularySuggestion[]>(
    sentences.map((s) => [s.id as string, (s.vocabulary_suggestions ?? []) as VocabularySuggestion[]]),
  );
  const bookOf = new Map(bookSentences.map((b) => [b.sentence_id as string, b.book_id as string]));
  const bookFilter = flag('book');
  const candidates = [...bookOf.keys()].filter(
    (id) => !introduced.has(id) && (!bookFilter || bookOf.get(id) === bookFilter),
  );
  const known = buildKnownLemmaSet([...introduced].map((id) => suggestionsBySentence.get(id)));

  const scored: Array<{ id: string; unknown: string[] }> = [];
  const unscorable = { 'no-tokens': 0, 'no-content-words': 0 };
  for (const id of candidates) {
    const score = scoreSentence(suggestionsBySentence.get(id), known);
    if (score.scorable) scored.push({ id, unknown: score.unknown });
    else unscorable[score.reason] += 1;
  }

  console.log(`sentences in books ${bookOf.size}; introduced ${introduced.size}; candidates ${candidates.length}${bookFilter ? ` (book ${bookFilter})` : ''}`);
  console.log(`scorable ${scored.length}; not scorable: no tokens ${unscorable['no-tokens']}, no content words ${unscorable['no-content-words']}; known lemmas ${known.size}`);
  if (unscorable['no-tokens'] > 0) {
    console.log('WARNING: untokenized sentences are excluded from i+1 ranking — run `npm run backfill:vocabulary-suggestions -- --apply`.');
  }
  console.log('\nunknown content lemmas per candidate:');
  console.log(formatHistogram(unknownCountHistogram(scored.map((s) => s.unknown.length), 10)));

  const perBook = new Map<string, { total: number; ready: number }>();
  for (const { id, unknown } of scored) {
    const book = bookOf.get(id)!;
    const entry = perBook.get(book) ?? { total: 0, ready: 0 };
    entry.total += 1;
    if (unknown.length >= 1 && unknown.length <= 2) entry.ready += 1;
    perBook.set(book, entry);
  }
  console.log('\nper book (total candidates, with 1-2 unknown):');
  for (const [book, { total, ready }] of perBook) console.log(`  ${book}\t${total}\t${ready}`);

  // Same down-weighting of fillers, discourse markers and names as the planner's i+1 ordering (orderByIPlusOne).
  const weights = new Map<string, number>();
  for (const { id } of scored) {
    for (const suggestion of suggestionsBySentence.get(id) ?? []) {
      if (!suggestion.selectedByDefault) continue;
      const key = lemmaKey(suggestion.expression, suggestion.reading);
      if (!weights.has(key)) weights.set(key, lemmaWeight(suggestion.expression, suggestion.pos));
    }
  }
  const value = unlockValueByLemma(scored.map((s) => s.unknown), undefined, (key) => weights.get(key) ?? 1);
  console.log(`\ntop ${top} unknown lemmas by (weighted) unlock value:`);
  for (const [lemma, score] of [...value.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) {
    console.log(`  ${score.toFixed(1)}\t${lemma}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
