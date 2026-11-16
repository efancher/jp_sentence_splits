/**
 * Read-only check for moved Word checks (docs/ROADMAP.md, "Reading and meaning recall"): how often a word in a
 * walked-through sentence also appears in a sentence the learner has not been introduced to, in a book in study
 * rotation, so the planner can ask about it there instead (`pickTransferSentence`). Nothing is written.
 *
 * Usage: npm run diagnose:word-check-transfer
 *
 * Approximation: the planner moves only the sentence's weakest-meaning word, chosen by the local strength model,
 * which this script does not rebuild. It reports (a) walked sentences where any checkable word could move and
 * (b) per distinct checkable word, so the real move rate lies between the "any word" share and the per-word share.
 * "Checkable" follows `meaningCheckWordsFor`: default-checked morphology words whose surface is in the sentence,
 * not inside a set expression. Words without a gloss are counted too (the planner also needs a meaning).
 */
import type { VocabularySuggestion } from '../src/domain/types';
import { findSetExpressions } from '../src/lib/setExpressions';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;

function checkableExpressions(japanese: string, suggestions: VocabularySuggestion[]): Set<string> {
  const ordered = [...suggestions].sort((a, b) => a.start - b.start);
  const inSet = new Set<number>();
  for (const { first, last } of findSetExpressions(ordered)) for (let i = first; i <= last; i += 1) inSet.add(i);
  const words = new Set<string>();
  ordered.forEach((suggestion, index) => {
    if (inSet.has(index) || !suggestion.selectedByDefault || !suggestion.expression) return;
    if (!suggestion.surface || !japanese.includes(suggestion.surface)) return;
    words.add(suggestion.expression);
  });
  return words;
}

async function main(): Promise<void> {
  const client = await createScriptSupabaseClient();
  const { id: ownerId } = await requireAuthedUser(client);
  const [books, bookSentences, events, studyItems, sentences] = await Promise.all([
    fetchAll<Row>(client, 'books', 'id,title,archived,suspended_at', ownerId, (r) => r),
    fetchAll<Row>(client, 'book_sentences', 'id,book_id,sentence_id,status', ownerId, (r) => r),
    fetchAll<Row>(client, 'sentence_learning_events', 'id,sentence_id,action,timestamp', ownerId, (r) => r),
    fetchAll<Row>(client, 'study_items', 'id,subject_id,subject_type', ownerId, (r) => r),
    fetchAll<Row>(client, 'sentences', 'id,japanese,vocabulary_suggestions', ownerId, (r) => r),
  ]);

  // Walked = latest walkthrough_completed after any walkthrough_reset (withoutResetWalkthroughs).
  const lastWalk = new Map<string, string>();
  const lastReset = new Map<string, string>();
  for (const event of events) {
    const map = event.action === 'walkthrough_completed' ? lastWalk : event.action === 'walkthrough_reset' ? lastReset : null;
    if (map && (!map.has(event.sentence_id) || event.timestamp > map.get(event.sentence_id)!)) map.set(event.sentence_id, event.timestamp);
  }
  const walked = new Set([...lastWalk].filter(([id, at]) => !lastReset.has(id) || at > lastReset.get(id)!).map(([id]) => id));

  const introduced = new Set<string>(walked);
  for (const row of bookSentences) if (row.status !== 'unstarted') introduced.add(row.sentence_id);
  for (const item of studyItems) if (item.subject_type === 'sentence') introduced.add(item.subject_id);

  const activeBooks = new Set(books.filter((book) => !book.archived && !book.suspended_at).map((book) => book.id as string));
  const activeMembership = new Set(bookSentences.filter((row) => activeBooks.has(row.book_id)).map((row) => row.sentence_id as string));
  const sentenceById = new Map(sentences.map((row) => [row.id as string, row]));
  const wordsOf = (id: string) => {
    const row = sentenceById.get(id);
    return row ? checkableExpressions(row.japanese ?? '', (row.vocabulary_suggestions ?? []) as VocabularySuggestion[]) : new Set<string>();
  };

  // Unstudied sentences in active books, indexed by word.
  const unstudiedByWord = new Map<string, number>();
  let unstudied = 0;
  for (const id of activeMembership) {
    if (introduced.has(id)) continue;
    unstudied += 1;
    for (const word of wordsOf(id)) unstudiedByWord.set(word, (unstudiedByWord.get(word) ?? 0) + 1);
  }

  const walkedActive = [...walked].filter((id) => activeMembership.has(id));
  let withWords = 0;
  let anyMovable = 0;
  const distinctWords = new Set<string>();
  for (const id of walkedActive) {
    const words = wordsOf(id);
    if (words.size === 0) continue;
    withWords += 1;
    if ([...words].some((word) => unstudiedByWord.has(word))) anyMovable += 1;
    for (const word of words) distinctWords.add(word);
  }
  const movableWords = [...distinctWords].filter((word) => unstudiedByWord.has(word));
  const counts = movableWords.map((word) => unstudiedByWord.get(word)!).sort((a, b) => a - b);
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : 'n/a');

  console.log(`Books in rotation: ${activeBooks.size} of ${books.length}`);
  console.log(`Unstudied sentences in those books: ${unstudied}`);
  console.log(`Walked sentences in those books: ${walkedActive.length} (${withWords} with a checkable word)`);
  console.log(`  …with at least one word that also appears in an unstudied sentence: ${anyMovable} (${pct(anyMovable, withWords)})`);
  console.log(`Distinct checkable words in walked sentences: ${distinctWords.size}`);
  console.log(`  …found in at least one unstudied sentence: ${movableWords.length} (${pct(movableWords.length, distinctWords.size)}), median ${median} sentence(s) each`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
