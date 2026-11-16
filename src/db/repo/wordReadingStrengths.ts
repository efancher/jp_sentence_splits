// ---------------------------------------------------------------------------
// Word reading strength: the shared per-word scoring the Reader, grammar
// reports and the planner all derive "known/weak" from (src/lib/wordStrength.ts
// holds the pure math). Moved down to the repo layer so the FSRS, grammar and
// planner sections above can share one instance of its cross-tap caches.
// ---------------------------------------------------------------------------

import type { Sentence, SentenceVocabulary, VocabularyItem } from '../../domain/types';
import { isReadingAnswerCorrect, surfaceReadingFromInline } from '../../lib/readingAnswer';
import { buildWordEvidence } from '../../lib/wordEvidence';
import { FREQUENCY_WAIT_MS, loadWordFrequency, lookupWordBand } from '../../lib/wordFrequency';
import { frequencyBandPrior, wordStrength } from '../../lib/wordStrength';
import { lemmaKey } from '../../lib/unknownLemmas';
import { stepTimer } from '../../lib/pageTiming';
import { getDb } from '../database';
import { loadSnapshot } from '../plannerSnapshots';
import {
  plannerPassActive,
  plannerShared,
  plannerWarmingActive,
  readAllLearningEventsForPass,
  readAllSentenceVocabularyForPass,
  readAllStudyItemsForPass,
  readAllVocabularyItemsForPass,
  traceStep,
} from './passReads';

/** How long one planning pass may reuse word strengths across its per-book lookups. */
export const PLANNER_STRENGTH_CACHE_MS = 60_000;

/** How long the Reader may reuse word strengths; "known" shading doesn't need to track each review live. */
export const READER_STRENGTH_CACHE_MS = 60_000;

/**
 * Reading strength of every word that has any evidence (unseen words are left
 * out — unseen is not weak), from local review, typed-recall and walkthrough
 * history. Selection input only (`wordStrength.ts`): no due dates, no FSRS effect.
 */
export type WordReadingStrengths = {
  strengthByWord: Map<string, number>;
  meaningStrengthOf: (wordId: string) => number;
  /** Meaning strength of a word with no vocabulary item yet: its frequency prior alone. */
  meaningStrengthOfLemma: (expression: string, reading: string) => number;
  wordsBySentence: Map<string, string[]>;
  links: SentenceVocabulary[];
  linksBySentence: Map<string, SentenceVocabulary[]>;
  vocabById: Map<string, VocabularyItem>;
  /** Vocabulary items by `lemmaKey(expression, reading)`. */
  vocabByLemma: Map<string, VocabularyItem>;
};

/** Clears the Reader's short-lived word-strength reuse (tests). */
export function resetWordStrengthCache(): void {
  strengthsCache = undefined;
}

let strengthsCache: { at: number; value: Promise<WordReadingStrengths> } | undefined;

/**
 * `maxAgeMs` reuses a recent result instead of re-reading five whole tables. Only
 * for callers that show it (the Reader's "known" words) rather than plan from it;
 * reading from the cache also keeps that caller's live query from re-running on
 * every review or learning event.
 */
export async function loadWordReadingStrengths(maxAgeMs = 0): Promise<WordReadingStrengths> {
  if (maxAgeMs === PLANNER_STRENGTH_CACHE_MS && (plannerPassActive() || plannerWarmingActive())) {
    // Planner callers: reuse across taps until one of the five tables it reads changes.
    return plannerShared(
      'wordStrengths',
      ['sentenceVocabulary', 'studyItems', 'reviews', 'sentenceLearningEvents', 'vocabularyItems'],
      () => loadWordReadingStrengths(0),
    );
  }
  if (maxAgeMs > 0 && strengthsCache && Date.now() - strengthsCache.at < maxAgeMs) return strengthsCache.value;
  const timer = stepTimer('wordStrengths');
  const value = (async () => {
    try {
      return await traceStep('loadWordReadingStrengths compute', () => computeWordReadingStrengths(timer));
    } finally {
      timer.done();
    }
  })();
  if (maxAgeMs > 0) {
    strengthsCache = { at: Date.now(), value };
    value.catch(() => {
      if (strengthsCache?.value === value) strengthsCache = undefined;
    });
  }
  return value;
}

async function computeWordReadingStrengths(timer: ReturnType<typeof stepTimer>): Promise<WordReadingStrengths> {
  const db = getDb();
  const [links, studyItems, reviews, events, vocab] = await Promise.all([
    readAllSentenceVocabularyForPass(),
    readAllStudyItemsForPass(),
    plannerShared('reviews', ['reviews'], () => loadSnapshot(db, 'reviews', () => db.reviews.toArray())),
    readAllLearningEventsForPass(),
    readAllVocabularyItemsForPass(),
  ]);
  timer.mark(`tables(${links.length}/${studyItems.length}/${reviews.length}/${events.length}/${vocab.length})`);
  const wordsBySentence = new Map<string, string[]>();
  const linksBySentence = new Map<string, SentenceVocabulary[]>();
  for (const link of links) {
    const words = wordsBySentence.get(link.sentenceId);
    if (words) words.push(link.vocabularyItemId);
    else wordsBySentence.set(link.sentenceId, [link.vocabularyItemId]);
    const list = linksBySentence.get(link.sentenceId);
    if (list) list.push(link);
    else linksBySentence.set(link.sentenceId, [link]);
  }

  // A typed reading on a reading_in_context card (flagged word, weakest word, or structure chunk)
  // asked about one word; find which by matching the saved expected reading to a linked word's reading.
  const itemById = new Map(studyItems.map((item) => [item.id, item]));
  const typed = reviews.filter((review) => {
    if (!review.responseRaw || !review.expectedAnswer) return false;
    return itemById.get(review.studyItemId)?.activityType === 'reading_in_context';
  });
  const typedSentenceIds = [
    ...new Set(typed.map((review) => review.contextSentenceId ?? itemById.get(review.studyItemId)!.subjectId)),
  ];
  const typedSentences = new Map(
    (await db.sentences.bulkGet(typedSentenceIds)).filter((s): s is Sentence => Boolean(s)).map((s) => [s.id, s]),
  );
  const typedRecalls: { wordId: string; at: number; success: boolean }[] = [];
  for (const review of typed) {
    const sentenceId = review.contextSentenceId ?? itemById.get(review.studyItemId)!.subjectId;
    const sentence = typedSentences.get(sentenceId);
    const at = Date.parse(review.timestamp);
    if (!sentence || Number.isNaN(at)) continue;
    const match = (linksBySentence.get(sentenceId) ?? []).find(
      (link) =>
        !!link.surfaceForm &&
        isReadingAnswerCorrect(
          review.expectedAnswer!,
          surfaceReadingFromInline(sentence.inlineReading, link.surfaceForm) ?? '\u0000',
        ),
    );
    if (match) {
      typedRecalls.push({
        wordId: match.vocabularyItemId,
        at,
        success: isReadingAnswerCorrect(review.responseRaw!, review.expectedAnswer!),
      });
    }
  }

  const evidence = buildWordEvidence({ reviews, studyItems, wordsBySentence, learningEvents: events, typedRecalls });
  const now = Date.now();
  const vocabById = new Map(vocab.map((item) => [item.id, item]));
  // General-language frequency is a small starting score; the learner's own evidence moves a word off it.
  timer.mark('typedRecalls');
  const frequency = await loadWordFrequency(FREQUENCY_WAIT_MS);
  timer.mark('frequency');
  const strengthByWord = new Map<string, number>();
  const priorOf = (wordId: string) => {
    const word = vocabById.get(wordId);
    return frequencyBandPrior(word ? lookupWordBand(frequency, word.expression, word.reading) : null);
  };
  for (const [wordId, items] of evidence) {
    strengthByWord.set(wordId, wordStrength(items, 'reading', now, { prior: priorOf(wordId) }));
  }
  // Meaning strength for any word, met or not: it only learns from meaning recall, so it starts at the prior.
  const meaningStrengthOf = (wordId: string) =>
    wordStrength(evidence.get(wordId) ?? [], 'meaning', now, { prior: priorOf(wordId) });
  const meaningStrengthOfLemma = (expression: string, reading: string) =>
    wordStrength([], 'meaning', now, { prior: frequencyBandPrior(lookupWordBand(frequency, expression, reading)) });
  const vocabByLemma = new Map(vocab.map((item) => [lemmaKey(item.expression, item.reading), item]));
  return { strengthByWord, meaningStrengthOf, meaningStrengthOfLemma, wordsBySentence, links, linksBySentence, vocabById, vocabByLemma };
}
