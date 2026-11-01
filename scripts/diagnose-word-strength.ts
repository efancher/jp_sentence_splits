/**
 * Read-only diagnostic: which words are weakest, by the word strength model
 * (`src/lib/wordStrength.ts`) fed from review and walkthrough history
 * (`src/lib/wordEvidence.ts`), and which sentences would cover them best.
 * Lets the weights be sanity-checked against the learner's own sense of what
 * is weak before anything drives the planner. Writes nothing.
 *
 * Meaning strength is not shown: no surface collects meaning recall yet.
 *
 * Usage: npm run diagnose:word-strength [-- --top 40]
 */
import type { ReviewRating } from '../src/domain/types';
import { buildWordEvidence } from '../src/lib/wordEvidence';
import { chooseSentencesForWeakWords, frequencyBandPrior, rankAtRiskWords } from '../src/lib/wordStrength';
import { ensureFrequencyIndex, lookupFrequency, type FrequencyBand } from './lib/jmdictFrequency';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function main() {
  const topFlag = process.argv.indexOf('--top');
  const top = topFlag >= 0 ? Math.max(1, Number(process.argv[topFlag + 1]) || 40) : 40;
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const [links, vocab, studyItems, reviews, events] = await Promise.all([
    fetchAll(supabase, 'sentence_vocabulary', 'id, sentence_id, vocabulary_item_id', user.id, (r) => ({
      sentenceId: String(r.sentence_id),
      wordId: String(r.vocabulary_item_id),
    })),
    fetchAll(supabase, 'vocabulary_items', 'id, expression, reading', user.id, (r) => ({
      id: String(r.id),
      expression: String(r.expression ?? ''),
      reading: String(r.reading ?? ''),
    })),
    fetchAll(supabase, 'study_items', 'id, subject_type, subject_id, activity_type', user.id, (r) => ({
      id: String(r.id),
      subjectType: String(r.subject_type) as 'vocabularyItem',
      subjectId: String(r.subject_id),
      activityType: String(r.activity_type),
    })),
    fetchAll(supabase, 'reviews', 'id, study_item_id, timestamp, rating, context_sentence_id', user.id, (r) => ({
      studyItemId: String(r.study_item_id),
      timestamp: String(r.timestamp),
      rating: String(r.rating) as ReviewRating,
      contextSentenceId: r.context_sentence_id ? String(r.context_sentence_id) : undefined,
    })),
    fetchAll(supabase, 'sentence_learning_events', 'id, sentence_id, timestamp, action', user.id, (r) => ({
      sentenceId: String(r.sentence_id),
      timestamp: String(r.timestamp),
      action: String(r.action) as 'walkthrough_completed',
    })),
  ]);

  const wordsBySentence = new Map<string, string[]>();
  const sentencesByWord = new Map<string, Set<string>>();
  for (const link of links) {
    wordsBySentence.set(link.sentenceId, [...(wordsBySentence.get(link.sentenceId) ?? []), link.wordId]);
    const set = sentencesByWord.get(link.wordId) ?? new Set<string>();
    set.add(link.sentenceId);
    sentencesByWord.set(link.wordId, set);
  }

  const evidence = buildWordEvidence({ reviews, studyItems, wordsBySentence, learningEvents: events });
  const now = Date.now();
  // Words with no evidence sit in sentences the learner has not met; they are unseen, not weak.
  const byId = new Map(vocab.map((v) => [v.id, v]));
  // Numerals and symbols (％, 25) are not words to learn; keep only entries with kana or kanji.
  const isWord = (id: string) => /[぀-ヿ一-鿿]/.test(byId.get(id)?.expression ?? '');
  const wordIds = [...sentencesByWord.keys()].filter((id) => evidence.has(id) && isWord(id));
  console.log(`${sentencesByWord.size - wordIds.length} linked entries excluded (no evidence yet, or numerals/symbols)`);
  console.log('Loading JMdict frequency bands (downloads + caches on first run)...');
  const frequency = await ensureFrequencyIndex();
  const bandByWord = new Map<string, FrequencyBand | null>();
  for (const wordId of wordIds) {
    const word = byId.get(wordId);
    const band = word ? lookupFrequency(frequency, word.expression, word.reading) : null;
    // Match the app (src/lib/wordFrequency.ts): words with only an unbanded priority tag get no prior.
    bandByWord.set(wordId, band === 'priority' ? null : band);
  }
  const priorByWord = new Map([...bandByWord].map(([id, band]) => [id, frequencyBandPrior(band)]));
  const ranked = rankAtRiskWords(wordIds, evidence, now, { facets: ['reading'], priorByWord });
  const bandLabel = (id: string) => {
    const band = bandByWord.get(id);
    return band === null || band === undefined ? 'no tag' : band === 'priority' ? 'common' : `nf${String(band).padStart(2, '0')}`;
  };
  const recallCount = (wordId: string) => (evidence.get(wordId) ?? []).filter((e) => e.kind === 'recall').length;

  console.log(`${wordIds.length} linked words, ${reviews.length} reviews, ${events.length} lesson events`);
  console.log(`\nWeakest ${top} words by reading strength (0 = no usable evidence):`);
  for (const entry of ranked.slice(0, top)) {
    const word = byId.get(entry.wordId);
    console.log(
      `  ${entry.strength.toFixed(2)}  ${(word?.expression ?? entry.wordId).padEnd(12)} ${(word?.reading ?? '').padEnd(12)} ` +
        `${bandLabel(entry.wordId).padEnd(7)} in ${sentencesByWord.get(entry.wordId)?.size ?? 0} sentence(s), ${recallCount(entry.wordId)} recall(s)`,
    );
  }

  const weakness = new Map(ranked.map((entry) => [entry.wordId, 1 - entry.strength]));
  const sentences = [...wordsBySentence].map(([sentenceId, ids]) => ({ sentenceId, wordIds: ids }));
  const picks = chooseSentencesForWeakWords(sentences, weakness, 5);
  console.log('\nSentences that together cover the most weakness (ids):');
  for (const id of picks) console.log(`  ${id}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
