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
import openJlptGrammar from '../src/data/openJlptGrammar.json';
import type { VocabularySuggestion } from '../src/domain/types';
import { buildGrammarDetector, buildReferenceIndex, curatedGrammarByPattern, wordSpansForDetection } from '../src/lib/grammarReference';
import { grammarPatternStrengths } from '../src/lib/grammarEvidence';
import { grammarLevelCosts, knownGrammarEntries } from '../src/lib/iPlusOne';
import {
  buildKnownLemmaSet,
  lemmaKey,
  lemmaWeight,
  scoreSentence,
  unknownCountHistogram,
  unlockValueByLemma,
  WORD_MIN_EXPOSURES,
} from '../src/lib/unknownLemmas';
import { READER_KNOWN_STRENGTH } from '../src/lib/wordStrength';
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
  const [bookSentences, events, studyItems, sentences, vocabularyItems] = await Promise.all([
    fetchAll<Row>(client, 'book_sentences', 'id,book_id,sentence_id,status', ownerId, (r) => r),
    fetchAll<Row>(client, 'sentence_learning_events', 'id,sentence_id,action,timestamp,target_key,support,outcome', ownerId, (r) => r),
    fetchAll<Row>(client, 'study_items', 'id,subject_id,subject_type,activity_type,fsrs_state', ownerId, (r) => r),
    fetchAll<Row>(client, 'sentences', 'id,japanese,vocabulary_suggestions', ownerId, (r) => r),
    fetchAll<Row>(client, 'vocabulary_items', 'id,expression,reading', ownerId, (r) => r),
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
  // Words with a reviewed reading/meaning card also count as known (the planner's loadKnownLemmaSet; pitch-only practice doesn't).
  const reviewedItemIds = new Set<string>();
  for (const item of studyItems) {
    if (
      item.subject_type === 'vocabularyItem' &&
      ['reading_retrieval', 'cloze', 'reading_production'].includes(item.activity_type) &&
      item.fsrs_state?.state !== 'new'
    ) {
      reviewedItemIds.add(item.subject_id);
    }
  }
  const reviewedKeys = vocabularyItems
    .filter((item) => reviewedItemIds.has(item.id))
    .map((item) => lemmaKey(item.expression, item.reading));
  const known = buildKnownLemmaSet([...introduced].map((id) => suggestionsBySentence.get(id)), reviewedKeys, WORD_MIN_EXPOSURES);

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

  // Same curated-grammar counting as the planner (loadCuratedGrammar): unambiguous OpenJLPT matches only.
  const [patterns, links] = await Promise.all([
    fetchAll<Row>(client, 'grammar_patterns', 'id,canonical_name,aliases', ownerId, (r) => r),
    fetchAll<Row>(client, 'sentence_grammar', 'id,sentence_id,grammar_pattern_id', ownerId, (r) => r),
  ]);
  const byPattern = curatedGrammarByPattern(
    patterns.map((p) => ({ id: p.id, canonicalName: p.canonical_name, aliases: p.aliases ?? [] })),
    buildReferenceIndex(openJlptGrammar.patterns),
  );
  const strengthByPattern = grammarPatternStrengths(
    events.map((e) => ({ timestamp: e.timestamp, action: e.action, support: e.support ?? undefined, outcome: e.outcome ?? undefined, target: e.target_key ? { kind: 'grammar' as never, key: e.target_key, label: '' } : undefined })),
    Date.now(),
  );
  const shaky = new Set<string>();
  const entriesBySentence = new Map<string, Set<string>>();
  const sightings = new Map<string, Set<string>>();
  const sight = (entryId: string, sentenceId: string) => sightings.set(entryId, (sightings.get(entryId) ?? new Set()).add(sentenceId));
  for (const link of links) {
    const entryId = byPattern.get(link.grammar_pattern_id);
    if (!entryId) continue;
    const strength = strengthByPattern.get(link.grammar_pattern_id);
    if (strength !== undefined && strength < READER_KNOWN_STRENGTH) shaky.add(entryId);
    if (!entriesBySentence.has(link.sentence_id)) entriesBySentence.set(link.sentence_id, new Set());
    entriesBySentence.get(link.sentence_id)!.add(entryId);
    if (introduced.has(link.sentence_id)) sight(entryId, link.sentence_id);
  }
  const linked = new Set(entriesBySentence.keys());
  const detect = buildGrammarDetector(openJlptGrammar.patterns);
  for (const sentence of sentences) {
    const words = wordSpansForDetection((sentence.vocabulary_suggestions ?? []) as VocabularySuggestion[]);
    for (const entryId of detect(sentence.japanese ?? '', words)) {
      if (!entriesBySentence.has(sentence.id)) entriesBySentence.set(sentence.id, new Set());
      entriesBySentence.get(sentence.id)!.add(entryId);
      if (introduced.has(sentence.id)) sight(entryId, sentence.id);
    }
  }
  // Same bar as the planner (knownGrammarEntries): two introduced sentences and no shaky reader evidence.
  const knownGrammar = knownGrammarEntries(new Map([...sightings].map(([id, set]) => [id, set.size])), shaky);
  const levelOf = new Map(openJlptGrammar.patterns.map((entry) => [entry.id, entry.level as string | undefined]));
  const present = new Map<string, string | undefined>();
  for (const entries of entriesBySentence.values()) for (const id of entries) present.set(id, levelOf.get(id));
  const patternCounts = new Map<string, number>();
  for (const entries of entriesBySentence.values()) for (const id of entries) patternCounts.set(id, (patternCounts.get(id) ?? 0) + 1);
  const nameOf = new Map(openJlptGrammar.patterns.map((entry) => [entry.id, entry.pattern]));
  console.log(`\nmost common curated patterns (check for over-matching): ${[...patternCounts].sort((a, b) => b[1] - a[1]).slice(0, top).map(([id, n]) => `${nameOf.get(id)}×${n}`).join('  ')}`);
  const cost = grammarLevelCosts(present, knownGrammar);
  const unmet = (id: string) => (knownGrammar.has(id) ? 0 : (cost.get(id) ?? 1));
  const withGrammar = scored.map(
    (s) => s.unknown.length + [...(entriesBySentence.get(s.id) ?? [])].reduce((sum, id) => sum + unmet(id), 0),
  );
  console.log(
    `\nsentences with curated grammar: ${entriesBySentence.size} (${linked.size} via AI links); curated patterns seen once+ ${sightings.size}, met (>= 2 introduced sentences, ${shaky.size} shaky) ${knownGrammar.size}; level-costed ${cost.size} of ${present.size} in use`,
  );
  console.log('unknown lemmas + unmet curated grammar (level-weighted) per candidate:');
  console.log(formatHistogram(unknownCountHistogram(withGrammar, 10)));

  // Planner bar (WORD_MIN_EXPOSURES sightings) against the old seen-once bar: reviewed-card words stay known either way.
  const knownOnce = buildKnownLemmaSet([...introduced].map((id) => suggestionsBySentence.get(id)), reviewedKeys);
  const pool = (knownSet: ReadonlySet<string>) => {
    let words = 0;
    let withGrammarPool = 0;
    for (const id of candidates) {
      const score = scoreSentence(suggestionsBySentence.get(id), knownSet);
      if (!score.scorable) continue;
      if (score.unknown.length >= 1 && score.unknown.length <= 2) words += 1;
      const total = score.unknown.length + [...(entriesBySentence.get(id) ?? [])].reduce((sum, entry) => sum + unmet(entry), 0);
      if (total >= 1 && total <= 2) withGrammarPool += 1;
    }
    return { words, withGrammarPool };
  };
  const once = pool(knownOnce);
  const twice = pool(known);
  console.log(`\nword exposure bar (1-2 unknown pool: words only / words + grammar):`);
  console.log(`  seen once counts as known: ${once.words} / ${once.withGrammarPool}   (known lemmas ${knownOnce.size})`);
  console.log(`  planner (>= ${WORD_MIN_EXPOSURES} sightings): ${twice.words} / ${twice.withGrammarPool}   (known lemmas ${known.size})`);

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
