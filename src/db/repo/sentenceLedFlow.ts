// ---------------------------------------------------------------------------
// Sentence-led flow: meaning-choice history, drill/pitch targets, vocabulary
// confusion and glossing signals (src/lib/meaningChoices.ts,
// src/lib/sequentialStudy.ts). Extracted whole — no other repository section
// is referenced from here any more.
// ---------------------------------------------------------------------------

import type {
  AlignmentResult,
  BookSentence,
  GrammarPattern,
  MeaningChoiceRecord,
  PitchDrillAttempt,
  Review,
  Sentence,
  SentenceAudio,
  SentenceGrammar,
  SentenceVocabulary,
  StudyItem,
  VocabularyConfusion,
  VocabularyConfusionType,
  VocabularyItem,
} from '../../domain/types';
import { ALIGNMENT_VERSION } from '../../lib/analysisApi';
import { startOfLocalDayIso } from '../../lib/dailyPractice';
import { createId } from '../../lib/ids';
import { isolatedWordSpans, type IsolatedWordSpans } from '../../lib/isolatedWordRange';
import { loadKanjiumPitchLookup } from '../../lib/kanjiumPitchLoader';
import { kanjiumTargetsForSuggestions } from '../../lib/kanjiumPitchLookup';
import { nowIso } from '../../lib/normalize';
import {
  buildMinimalPairTrials,
  findMinimalPairContrasts,
  type MinimalPairOccurrence,
  type MinimalPairTrial,
} from '../../lib/pitchAccentMinimalPairs';
import type { PitchAccentTarget } from '../../lib/pitchAccentObservations';
import { resolveInflectedPitchAccent } from '../../lib/pitchAccentShift';
import {
  inWordShape,
  isPlausibleClipSpan,
  type PitchWordClip,
} from '../../lib/pitchWordClip';
import type { TimeRangeMs } from '../../lib/recording';
import { isSequentialStudyMode } from '../../lib/sentenceLed';
import {
  type SentencePitchAccentTarget,
  trailingBunsetsuParticles,
} from '../../lib/sentencePitchAccent';
import { type SequentialBookStatus, type SequentialSentenceStatus } from '../../lib/sequentialStudy';
import { membershipIsShelved, sentenceIsSuspendedOnly } from '../../lib/suspendedBooks';
import { getDb, readSettings } from '../database';
import { updateSettings } from './settingsWrites';
import { notifySync, notifySyncMany } from '../syncNotify';
import { saveReferenceAlignment } from './alignmentCaches';
import { getShadowingWeakWords } from './shadowingAttempts';
import {
  filterToIntroducedSentenceIds,
  getProficientVocabularyItemIds,
  getSentenceFullReviewReadiness,
  recordReview,
} from './reviewScheduling';
import { getSequentialBookStatus } from './sequentialUnlocks';
import { loadSuspendedBookIndex } from './suspendedIndex';

export interface SentenceReviewHistory {
  /** Oldest first, so meaning-choice distractors can rotate between attempts. */
  meaningChoices: MeaningChoiceRecord[];
  /** Latest reading-in-context review only; a later unflagged review clears this. */
  missedReadings: string[];
}

/**
 * Read the active sentence's history through the existing compound/item indexes.
 * Queue eligibility doesn't depend on this evidence: fetching it for every
 * queued sentence made opening Review scale with the entire review history.
 * One snapshot supplies both the meaning choices and the missed-reading prompt.
 */
export async function getSentenceReviewHistory(sentenceId: string): Promise<SentenceReviewHistory> {
  const db = getDb();
  return db.transaction('r', db.studyItems, db.reviews, async () => {
    const items = await db.studyItems
      .where('[subjectType+subjectId+activityType]')
      .equals(['sentence', sentenceId, 'reading_in_context'])
      .toArray();
    if (items.length === 0) return { meaningChoices: [], missedReadings: [] };
    const query = db.reviews.where('studyItemId');
    // Normally one item; retain history from duplicate items in older imports.
    const reviews = await (items.length === 1
      ? query.equals(items[0]!.id)
      : query.anyOf(items.map((item) => item.id))).toArray();
    reviews.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return {
      meaningChoices: reviews.flatMap((review) => review.meaningChoice ? [review.meaningChoice] : []),
      missedReadings: reviews.at(-1)?.missedReadings ?? [],
    };
  });
}

export interface SequentialSentenceView {
  book: SequentialBookStatus;
  current?: SequentialSentenceStatus;
  previous?: SequentialSentenceStatus;
  next?: SequentialSentenceStatus;
}

/** Undefined when sequential study mode is off. Read-only, safe in a live query. */
export async function getSequentialSentenceView(
  bookId: string,
  sentenceId?: string,
): Promise<SequentialSentenceView | undefined> {
  if (!isSequentialStudyMode(await readSettings())) return undefined;
  const book = await getSequentialBookStatus(bookId);
  const index = sentenceId ? book.sentences.findIndex((s) => s.sentenceId === sentenceId) : -1;
  return {
    book,
    current: index >= 0 ? book.sentences[index] : undefined,
    previous: index > 0 ? book.sentences[index - 1] : undefined,
    next: index >= 0 ? book.sentences[index + 1] : undefined,
  };
}

/** Manual escape hatch: open one locked sentence (e.g. a check the learner finds unusable). */
export async function unlockSentenceManually(sentenceId: string): Promise<void> {
  const settings = await readSettings();
  await updateSettings({
    sequentialUnlockOverrides: [...new Set([...(settings.sequentialUnlockOverrides ?? []), sentenceId])],
  });
}

/**
 * Drop persisted unlocks for sentences that are still unstarted, so the current
 * rules decide again. Started sentences stay open on their own status.
 * Returns how many were dropped.
 */
export async function resetUnstartedSequentialUnlocks(): Promise<number> {
  const settings = await readSettings();
  const overrides = settings.sequentialUnlockOverrides ?? [];
  if (overrides.length === 0) return 0;
  const db = getDb();
  const memberships = await db.bookSentences.where('sentenceId').anyOf(overrides).toArray();
  const started = new Set(memberships.filter((m) => m.status !== 'unstarted').map((m) => m.sentenceId));
  const unstarted = new Set(memberships.filter((m) => m.status === 'unstarted').map((m) => m.sentenceId));
  const keep = overrides.filter((id) => started.has(id) || !unstarted.has(id));
  if (keep.length === overrides.length) return 0;
  await updateSettings({ sequentialUnlockOverrides: keep });
  return overrides.length - keep.length;
}

/**
 * Bridge from shadowing to the SRS: a close A/B-rated shadow of a sentence
 * ("better"/"same" vs the reference) is real evidence the learner can read
 * and parse that whole sentence, so it logs one `natural_encounter` review
 * (rating `good`) against the sentence's `reading_in_context` study item —
 * the same mechanism `recordNaturalEncounter` uses for the "Recognized this
 * without hints?" panel on `/practice`.
 *
 * Deliberately narrow:
 * - Only the sentence-level `reading_in_context` card, never the individual
 *   word cards — caps the schedule impact at one row per shadowed sentence.
 * - **No-op if that study item doesn't already exist.** Creating one would
 *   bypass the passage-readiness gate (`ReviewPage`'s `activityIsReady`),
 *   which shadowing evidence has no business doing.
 * - Deduped: skipped if a `natural_encounter` review already landed on this
 *   item since its last scheduled review, so re-rating the same take (or
 *   rating several takes of one sitting) doesn't ratchet the interval.
 *
 * Returns the recorded review, or null when it no-opped.
 */
export async function recordShadowingEncounter(
  sentenceId: string,
): Promise<{ review: Review; studyItem: StudyItem } | null> {
  const db = getDb();
  const studyItem = await db.studyItems
    .where('[subjectType+subjectId+activityType]')
    .equals(['sentence', sentenceId, 'reading_in_context'])
    .first();
  if (!studyItem) return null;

  const reviews = await db.reviews.where('studyItemId').equals(studyItem.id).toArray();
  const lastScheduledAt = reviews
    .filter((review) => review.source !== 'natural_encounter')
    .map((review) => review.timestamp)
    .sort()
    .at(-1);
  const alreadyCounted = reviews.some(
    (review) =>
      review.source === 'natural_encounter' &&
      (lastScheduledAt === undefined || review.timestamp > lastScheduledAt),
  );
  if (alreadyCounted) return null;

  return recordReview({
    studyItemId: studyItem.id,
    rating: 'good',
    source: 'natural_encounter',
    contextSentenceId: sentenceId,
  });
}

/**
 * Pick a sentence to display when reviewing a vocabulary item directly —
 * the most recently linked sentence that still exists — along with that
 * specific link's `surfaceForm` (Phase 7.2), if it has one. Returns
 * undefined if the vocabulary item has no surviving sentence link
 * (shouldn't normally happen, since links are only removed when a confirm
 * deselects a word, not when the word itself is deleted).
 */
export async function pickContextSentenceForVocabularyItem(
  vocabularyItemId: string,
): Promise<{ sentence: Sentence; surfaceForm?: string } | undefined> {
  const db = getDb();
  const links = await db.sentenceVocabulary
    .where('vocabularyItemId')
    .equals(vocabularyItemId)
    .toArray();
  if (links.length === 0) return undefined;
  const sorted = [...links].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  for (const link of sorted) {
    const sentence = await db.sentences.get(link.sentenceId);
    if (sentence) return { sentence, surfaceForm: link.surfaceForm };
  }
  return undefined;
}

export interface VocabularyTargetCandidate {
  vocabularyItem: VocabularyItem;
  sentence: Sentence;
  surfaceForm: string;
  /** The link this candidate was chosen from — carries any manual
   * word-audio range (`audioStartMs`/`audioEndMs`). */
  link?: SentenceVocabulary;
}

/**
 * Vocabulary items, restricted to `sentenceIds`, that have a
 * `surfaceForm`-bearing link and are therefore eligible targets for any
 * review experience that highlights or blanks a specific occurrence of a
 * word in its sentence — reading retrieval (Phase 7.2) and cloze (Phase
 * 7.3) both consume this, since they share the same eligibility condition
 * and only differ in how the target is rendered. One candidate per
 * distinct vocabulary item (first qualifying link found, preferring one
 * whose sentence isn't suspended-book-only over one that is — 2026-09-24,
 * see below), not one per sentence×word pair, so seeding stays bounded by
 * vocabulary size, not sentence count.
 *
 * `sentenceIds` is normally already suspension-filtered by the caller
 * (ReviewPage's global scope), but that filtering happens once per queue
 * build and can go stale for a long-lived session; this function also
 * checks directly so a shared word never lands on a since-suspended
 * sentence as its representative — that sentence's reading-context
 * neighbours are held back too, so the card ends up with no passage at all
 * (card issue report, 2026-09-23: 楽しい picked え、楽しかったね。, whose only
 * book had been suspended, when the word also has links in active books).
 *
 * Returned in `sentenceIds` order (each word's representative sentence's
 * position in the caller's reading order) — `.anyOf()` returns rows sorted
 * by the indexed `sentenceId` itself, not by `sentenceIds` order, so without
 * this the new-word queue effectively randomized which sentence's words
 * came up together instead of clustering by sentence (user request,
 * 2026-09-24: introduce a sentence's vocabulary together so its
 * reading_in_context card unlocks sooner, rather than trickling in a word
 * at a time from unrelated sentences).
 */
export async function getVocabularyTargetCandidates(
  sentenceIds: string[],
): Promise<VocabularyTargetCandidate[]> {
  if (sentenceIds.length === 0) return [];
  const db = getDb();
  const [links, suspendedIndex] = await Promise.all([
    db.sentenceVocabulary.where('sentenceId').anyOf(sentenceIds).toArray(),
    loadSuspendedBookIndex(),
  ]);
  const bestLinkByItemId = new Map<string, SentenceVocabulary>();
  for (const link of links) {
    if (!link.surfaceForm) continue;
    const existing = bestLinkByItemId.get(link.vocabularyItemId);
    if (!existing) {
      bestLinkByItemId.set(link.vocabularyItemId, link);
      continue;
    }
    if (
      suspendedIndex &&
      sentenceIsSuspendedOnly(existing.sentenceId, suspendedIndex) &&
      !sentenceIsSuspendedOnly(link.sentenceId, suspendedIndex)
    ) {
      bestLinkByItemId.set(link.vocabularyItemId, link);
    }
  }
  if (bestLinkByItemId.size === 0) return [];

  const entries = [...bestLinkByItemId.entries()];
  const [vocabularyItems, sentences] = await Promise.all([
    db.vocabularyItems.bulkGet(entries.map(([itemId]) => itemId)),
    db.sentences.bulkGet(entries.map(([, link]) => link.sentenceId)),
  ]);

  const candidates: VocabularyTargetCandidate[] = [];
  entries.forEach(([, link], index) => {
    const vocabularyItem = vocabularyItems[index];
    const sentence = sentences[index];
    if (!vocabularyItem || !sentence || !link.surfaceForm) return;
    candidates.push({ vocabularyItem, sentence, surfaceForm: link.surfaceForm, link });
  });
  const sentenceOrder = new Map(sentenceIds.map((id, index) => [id, index]));
  candidates.sort(
    (a, b) =>
      (sentenceOrder.get(a.sentence.id) ?? 0) - (sentenceOrder.get(b.sentence.id) ?? 0),
  );
  return candidates;
}

export interface PitchAccentDrillSentence {
  sentence: Sentence;
  /** The sentence's confirmed words that carry dictionary pitch-accent data. */
  targets: PitchAccentTarget[];
  /**
   * `target.surfaceForm` → vocabulary item id, for logging drill attempts
   * (`logPitchDrillAttempt`) without threading an id through the shared
   * `PitchAccentTarget` type (used well beyond this drill).
   */
  targetVocabularyItemIds: Record<string, string>;
}

/**
 * Sentences eligible for the audio-less pitch-accent production drill
 * (docs/ROADMAP.md): confirmed vocabulary with dictionary
 * `pitchAccentPositions` and **no** reference recording — so the majority
 * of the Satori corpus, which the reference-audio-gated `pitch_accent` SRS
 * card and the shadowing analysis can't reach. Scoring only needs the
 * learner's own forced alignment + pitch (`buildPitchAccentShapeObservations`),
 * never a reference clip.
 *
 * Gated on the same full-review readiness rule as shadowing candidates
 * (`getSentenceFullReviewReadiness`) — pronunciation practice shouldn't
 * compete for attention with vocabulary the learner hasn't shown recall of
 * yet (see the `findShadowCandidates` precedent / the vocab-before-glossing
 * stance).
 */
export async function getPitchAccentDrillSentences(): Promise<PitchAccentDrillSentence[]> {
  const db = getDb();
  const links = (await db.sentenceVocabulary.toArray()).filter((link) => !!link.surfaceForm);
  const linksBySentence = new Map<string, SentenceVocabulary[]>();
  for (const link of links) {
    const list = linksBySentence.get(link.sentenceId) ?? [];
    list.push(link);
    linksBySentence.set(link.sentenceId, list);
  }
  const sentenceIds = [...linksBySentence.keys()];
  if (sentenceIds.length === 0) return [];

  const [sentences, audioRows, vocabularyItems, readiness] = await Promise.all([
    db.sentences.bulkGet(sentenceIds),
    db.sentenceAudio.where('sentenceId').anyOf(sentenceIds).toArray(),
    db.vocabularyItems.bulkGet([...new Set(links.map((link) => link.vocabularyItemId))]),
    getSentenceFullReviewReadiness(sentenceIds),
  ]);
  const audioSentenceIds = new Set(audioRows.map((row) => row.sentenceId));
  const sentenceById = new Map(
    sentences.filter((row): row is Sentence => Boolean(row)).map((row) => [row.id, row]),
  );
  const vocabularyItemById = new Map(
    vocabularyItems
      .filter((row): row is VocabularyItem => Boolean(row))
      .map((row) => [row.id, row]),
  );

  const result: PitchAccentDrillSentence[] = [];
  for (const [sentenceId, sentenceLinks] of linksBySentence) {
    if (audioSentenceIds.has(sentenceId)) continue;
    if (readiness.get(sentenceId) !== true) continue;
    const sentence = sentenceById.get(sentenceId);
    if (!sentence) continue;
    const targets: PitchAccentTarget[] = [];
    const targetVocabularyItemIds: Record<string, string> = {};
    for (const link of sentenceLinks) {
      const item = vocabularyItemById.get(link.vocabularyItemId);
      if (!link.surfaceForm || !item) continue;
      const resolved = resolveInflectedPitchAccent({
        vocabularyItem: item,
        sentence,
        surfaceForm: link.surfaceForm,
      });
      if (!resolved) continue;
      // The resolver's own full conjugated surface, not the possibly-
      // truncated stored link.surfaceForm (言い for 言います) — keeps the
      // highlighted span and "what follows" lookup aligned with the reading/
      // position above, which already cover the whole conjugated word.
      const { surfaceForm } = resolved;
      const occurrence = sentence.japanese.indexOf(surfaceForm);
      targets.push({
        surfaceForm,
        reading: resolved.reading,
        pitchAccentPositions: [resolved.position],
        followingMora:
          occurrence >= 0
            ? trailingBunsetsuParticles(sentence.japanese, occurrence + surfaceForm.length)
            : '',
      });
      targetVocabularyItemIds[surfaceForm] = link.vocabularyItemId;
    }
    if (targets.length === 0) continue;
    result.push({ sentence, targets, targetVocabularyItemIds });
  }
  result.sort(
    (a, b) => a.sentence.firstOccurrenceIndex - b.sentence.firstOccurrenceIndex,
  );
  return result;
}

export interface PitchAccentDrillWord {
  vocabularyItem: VocabularyItem;
  /** An example sentence containing the word — shown as context under the drill. */
  sentence: Sentence;
  /** The word's surface form as it appears in that sentence. */
  surfaceForm: string;
  /**
   * The run of single-kana bunsetsu particles that follows the word in that
   * sentence (`は`/`が`/`を`/… — `trailingBunsetsuParticles`), or `''`. The
   * particle carries the tail of the word's accent phrase, so it's the only
   * place a phrase-final heiban/odaka fall is audible — the drill shows and
   * records `surfaceForm + followingParticle`.
   */
  followingParticle: string;
}

/**
 * Words eligible for the single-word variant of the audio-less pitch-accent
 * drill: every confirmed vocabulary item the learner has reviewed to
 * proficiency (`getProficientVocabularyItemIds`, the same "shown recall"
 * bar as `getPitchAccentDrillSentences`) that carries dictionary
 * `pitchAccentPositions`, paired with one example sentence for context.
 *
 * Deliberately *not* gated on the example sentence lacking reference audio,
 * unlike `getPitchAccentDrillSentences` — you're drilling the word in
 * isolation, not the sentence, so the overlap with the reference-audio-gated
 * `pitch_accent` SRS card doesn't apply. That also makes the pool much
 * larger. One entry per distinct word; the example occurrence is picked to
 * prefer (1) one with a trailing bunsetsu particle (so a phrase-final fall
 * is audible), then (2) the word's dictionary form, then (3) the earliest.
 */
interface ExampleOccurrence {
  sentence: Sentence;
  surfaceForm: string;
  followingParticle: string;
}

/**
 * Best example occurrence per vocabulary item id among `links`, restricted
 * to `itemIds`: prefers (1) an occurrence with a trailing bunsetsu particle
 * (so a phrase-final heiban/odaka fall is audible), then (2) the word's
 * dictionary form, then (3) the earliest sentence. Shared by
 * `getPitchAccentDrillWords` and `getPitchAccentFocusWords`.
 */
function bestExampleOccurrencesByItemId(
  links: SentenceVocabulary[],
  sentenceById: Map<string, Sentence>,
  itemById: Map<string, VocabularyItem>,
  itemIds: Set<string>,
): Map<string, ExampleOccurrence> {
  interface Candidate extends ExampleOccurrence {
    score: number;
  }
  const bestByItemId = new Map<string, Candidate>();
  for (const link of links) {
    if (!link.surfaceForm) continue;
    if (!itemIds.has(link.vocabularyItemId)) continue;
    const item = itemById.get(link.vocabularyItemId);
    if (!item) continue;
    const sentence = sentenceById.get(link.sentenceId);
    if (!sentence) continue;

    const occurrence = sentence.japanese.indexOf(link.surfaceForm);
    const followingParticle =
      occurrence >= 0
        ? trailingBunsetsuParticles(sentence.japanese, occurrence + link.surfaceForm.length)
        : '';
    const score =
      (followingParticle ? 2 : 0) + (link.surfaceForm === item.expression ? 1 : 0);

    const current = bestByItemId.get(link.vocabularyItemId);
    if (
      !current ||
      score > current.score ||
      (score === current.score &&
        sentence.firstOccurrenceIndex < current.sentence.firstOccurrenceIndex)
    ) {
      bestByItemId.set(link.vocabularyItemId, {
        sentence,
        surfaceForm: link.surfaceForm,
        followingParticle,
        score,
      });
    }
  }
  return bestByItemId;
}

export async function getPitchAccentDrillWords(): Promise<PitchAccentDrillWord[]> {
  const db = getDb();
  const links = (await db.sentenceVocabulary.toArray()).filter((link) => !!link.surfaceForm);
  if (links.length === 0) return [];

  const vocabularyItems = await db.vocabularyItems.bulkGet([
    ...new Set(links.map((link) => link.vocabularyItemId)),
  ]);
  const pitchCarryingItemById = new Map(
    vocabularyItems
      .filter((row): row is VocabularyItem => Boolean(row))
      .filter((row) => (row.pitchAccentPositions?.length ?? 0) > 0)
      .map((row) => [row.id, row]),
  );
  if (pitchCarryingItemById.size === 0) return [];

  const proficientIds = await getProficientVocabularyItemIds([...pitchCarryingItemById.keys()]);
  if (proficientIds.size === 0) return [];

  const sentenceById = new Map(
    (await db.sentences.bulkGet([...new Set(links.map((link) => link.sentenceId))]))
      .filter((row): row is Sentence => Boolean(row))
      .map((row) => [row.id, row]),
  );

  const bestByItemId = bestExampleOccurrencesByItemId(
    links,
    sentenceById,
    pitchCarryingItemById,
    proficientIds,
  );

  const result: PitchAccentDrillWord[] = [];
  for (const [itemId, { sentence, surfaceForm, followingParticle }] of bestByItemId) {
    result.push({
      vocabularyItem: pitchCarryingItemById.get(itemId)!,
      sentence,
      surfaceForm,
      followingParticle,
    });
  }
  result.sort((a, b) => a.sentence.firstOccurrenceIndex - b.sentence.firstOccurrenceIndex);
  return result;
}

/**
 * Words whose `pitch_accent` SRS card has been missed twice in a row (last 2
 * reviews both rated `again` or `hard`) and haven't had a free-drill attempt
 * logged since — the "extra practice" focus queue surfaced on
 * `PitchAccentDrillPage`. Deliberately not FSRS-driven: this never touches
 * the SRS card's own scheduling, only reads its review history. Clears the
 * moment any drill attempt is logged for the word (`logPitchDrillAttempt`,
 * either mode, any outcome) — it's extra practice, not a retest gate — and
 * reappears only if the SRS card is missed twice again afterward.
 */
export async function getPitchAccentFocusWords(): Promise<PitchAccentDrillWord[]> {
  const db = getDb();
  const pitchAccentStudyItems = await db.studyItems
    .where('activityType')
    .equals('pitch_accent')
    .toArray();
  if (pitchAccentStudyItems.length === 0) return [];
  const studyItemById = new Map(pitchAccentStudyItems.map((item) => [item.id, item]));

  const reviews = await db.reviews
    .where('studyItemId')
    .anyOf([...studyItemById.keys()])
    .sortBy('timestamp');
  const reviewsByStudyItem = new Map<string, Review[]>();
  for (const review of reviews) {
    const list = reviewsByStudyItem.get(review.studyItemId) ?? [];
    list.push(review);
    reviewsByStudyItem.set(review.studyItemId, list);
  }

  // vocabularyItemId -> timestamp of the 2nd consecutive miss.
  const missedAt = new Map<string, string>();
  for (const [studyItemId, itemReviews] of reviewsByStudyItem) {
    if (itemReviews.length < 2) continue;
    const lastTwo = itemReviews.slice(-2);
    if (lastTwo.every((review) => review.rating === 'again' || review.rating === 'hard')) {
      const studyItem = studyItemById.get(studyItemId)!;
      missedAt.set(studyItem.subjectId, lastTwo[1]!.timestamp);
    }
  }
  if (missedAt.size === 0) return [];

  const attempts = await db.pitchDrillAttempts
    .where('vocabularyItemId')
    .anyOf([...missedAt.keys()])
    .toArray();
  const latestAttemptAt = new Map<string, string>();
  for (const attempt of attempts) {
    if (!attempt.vocabularyItemId) continue;
    const current = latestAttemptAt.get(attempt.vocabularyItemId);
    if (!current || attempt.timestamp > current) {
      latestAttemptAt.set(attempt.vocabularyItemId, attempt.timestamp);
    }
  }

  const focusIds = new Set(
    [...missedAt.entries()]
      .filter(([id, missedTimestamp]) => {
        const practicedAt = latestAttemptAt.get(id);
        return !practicedAt || practicedAt < missedTimestamp;
      })
      .map(([id]) => id),
  );
  if (focusIds.size === 0) return [];

  const [vocabularyItems, links] = await Promise.all([
    db.vocabularyItems.bulkGet([...focusIds]),
    db.sentenceVocabulary.where('vocabularyItemId').anyOf([...focusIds]).toArray(),
  ]);
  const itemById = new Map(
    vocabularyItems.filter((row): row is VocabularyItem => Boolean(row)).map((row) => [row.id, row]),
  );
  const sentenceById = new Map(
    (await db.sentences.bulkGet([...new Set(links.map((link) => link.sentenceId))]))
      .filter((row): row is Sentence => Boolean(row))
      .map((row) => [row.id, row]),
  );

  const bestByItemId = bestExampleOccurrencesByItemId(links, sentenceById, itemById, focusIds);

  const result: PitchAccentDrillWord[] = [];
  for (const [itemId, { sentence, surfaceForm, followingParticle }] of bestByItemId) {
    const item = itemById.get(itemId);
    if (!item) continue;
    result.push({ vocabularyItem: item, sentence, surfaceForm, followingParticle });
  }
  // Most recently missed first.
  result.sort((a, b) => {
    const aMissed = missedAt.get(a.vocabularyItem.id) ?? '';
    const bMissed = missedAt.get(b.vocabularyItem.id) ?? '';
    return bMissed.localeCompare(aMissed);
  });
  return result;
}

/**
 * Words flagged with a recurring pitch-accent mismatch across shadowing
 * attempts (`getShadowingWeakWords`, `SHADOWING_WEAK_WORD_MIN_ATTEMPTS`+) —
 * the shadowing-side sibling of `getPitchAccentFocusWords`' SRS-miss queue,
 * same "extra practice" slot on `PitchAccentDrillPage`. `wordIssues` only
 * stores a surface form, not a vocabulary item id, so this resolves each
 * weak surface form back to its (confirmed, proficient, pitch-carrying)
 * vocabulary item via `sentenceVocabulary`, then picks the same
 * dictionary-form-preferring example occurrence `getPitchAccentFocusWords`
 * does. Never clears itself the way the review-miss queue does (no
 * "practiced since the miss" signal exists on the shadowing side) — it's a
 * live reflection of `getShadowingWeakWords`, so it shrinks only once new
 * attempts stop reproducing the mismatch.
 */
export async function getPitchAccentShadowingFocusWords(): Promise<PitchAccentDrillWord[]> {
  const weakWords = await getShadowingWeakWords();
  if (weakWords.length === 0) return [];
  const lastSeenBySurfaceForm = new Map(weakWords.map((word) => [word.surfaceForm, word.lastSeenAt]));

  const db = getDb();
  const matchingLinks = (await db.sentenceVocabulary.toArray()).filter(
    (link) => link.surfaceForm && lastSeenBySurfaceForm.has(link.surfaceForm),
  );
  if (matchingLinks.length === 0) return [];
  const candidateItemIds = new Set(matchingLinks.map((link) => link.vocabularyItemId));

  const vocabularyItems = await db.vocabularyItems.bulkGet([...candidateItemIds]);
  const pitchCarryingItemById = new Map(
    vocabularyItems
      .filter((row): row is VocabularyItem => Boolean(row))
      .filter((row) => (row.pitchAccentPositions?.length ?? 0) > 0)
      .map((row) => [row.id, row]),
  );
  if (pitchCarryingItemById.size === 0) return [];

  const proficientIds = await getProficientVocabularyItemIds([...pitchCarryingItemById.keys()]);
  if (proficientIds.size === 0) return [];

  // Most recent weak-attempt timestamp among this item's flagged surface forms.
  const lastSeenByItemId = new Map<string, string>();
  for (const link of matchingLinks) {
    if (!proficientIds.has(link.vocabularyItemId)) continue;
    const lastSeenAt = lastSeenBySurfaceForm.get(link.surfaceForm!);
    if (!lastSeenAt) continue;
    const current = lastSeenByItemId.get(link.vocabularyItemId);
    if (!current || lastSeenAt > current) lastSeenByItemId.set(link.vocabularyItemId, lastSeenAt);
  }

  const links = await db.sentenceVocabulary
    .where('vocabularyItemId')
    .anyOf([...proficientIds])
    .toArray();
  const sentenceById = new Map(
    (await db.sentences.bulkGet([...new Set(links.map((link) => link.sentenceId))]))
      .filter((row): row is Sentence => Boolean(row))
      .map((row) => [row.id, row]),
  );

  const bestByItemId = bestExampleOccurrencesByItemId(
    links,
    sentenceById,
    pitchCarryingItemById,
    proficientIds,
  );

  const result: PitchAccentDrillWord[] = [];
  for (const [itemId, { sentence, surfaceForm, followingParticle }] of bestByItemId) {
    const item = pitchCarryingItemById.get(itemId);
    if (!item) continue;
    result.push({ vocabularyItem: item, sentence, surfaceForm, followingParticle });
  }
  // Most recently flagged first, same convention as `getPitchAccentFocusWords`.
  result.sort((a, b) => {
    const aSeen = lastSeenByItemId.get(a.vocabularyItem.id) ?? '';
    const bSeen = lastSeenByItemId.get(b.vocabularyItem.id) ?? '';
    return bSeen.localeCompare(aSeen);
  });
  return result;
}

export interface PitchAccentMinimalPairOccurrence extends MinimalPairOccurrence {
  expression: string;
  meaning: string;
  surfaceForm: string;
  sentence: Sentence;
  audio: SentenceAudio;
}

/**
 * Every audio-backed occurrence eligible for the "real-audio pitch-
 * perception bridge" same/different warm-up (docs/ROADMAP.md): a confirmed
 * (vocab picker, `vocabularyReviewStatus === 'confirmed'`) word with
 * dictionary `pitchAccentPositions`, restricted to a sentence that both has
 * reference audio *and* uses the word's exact citation form
 * (`link.surfaceForm === expression`) — near-minimal accent pairs are almost
 * always nouns, and skipping inflected occurrences avoids resolving
 * `pitchAccentPositions` (a citation-form value) against a conjugated
 * surface. Deliberately perception-only: this is a listening-discrimination task with the
 * answer shown right after, not a recall/production check, so it doesn't
 * need `getProficientVocabularyItemIds`'s FSRS-reviewed bar. Sentences that
 * live only in suspended books/chapters are skipped (and `bookId` is taken
 * from a non-shelved membership).
 * `bookId` doubles as a "same speaker" proxy: a book is
 * normally one show/narrator or one consistent cast, so two occurrences
 * sharing a `bookId` are treated as same-speaker and two differing ones as
 * cross-speaker (`STATUS.md`) — an approximation, not a verified per-clip
 * speaker identity, since none exists in this corpus.
 */
export async function getPitchAccentMinimalPairOccurrences(): Promise<
  PitchAccentMinimalPairOccurrence[]
> {
  const db = getDb();
  const [allLinks, suspendedIndex] = await Promise.all([
    db.sentenceVocabulary.toArray(),
    loadSuspendedBookIndex(),
  ]);
  let links = allLinks.filter(
    (link) =>
      !!link.surfaceForm &&
      !(suspendedIndex && sentenceIsSuspendedOnly(link.sentenceId, suspendedIndex)),
  );
  if (links.length > 0) {
    const introduced = await filterToIntroducedSentenceIds(links.map((link) => link.sentenceId));
    links = links.filter((link) => introduced.has(link.sentenceId));
  }
  if (links.length === 0) return [];

  const sentenceIds = [...new Set(links.map((link) => link.sentenceId))];
  const [audioRows, vocabularyItems, sentences, bookSentences, analyses] = await Promise.all([
    db.sentenceAudio.where('sentenceId').anyOf(sentenceIds).toArray(),
    db.vocabularyItems.bulkGet([...new Set(links.map((link) => link.vocabularyItemId))]),
    db.sentences.bulkGet(sentenceIds),
    db.bookSentences.where('sentenceId').anyOf(sentenceIds).toArray(),
    db.analyses.where('sentenceId').anyOf(sentenceIds).toArray(),
  ]);
  if (audioRows.length === 0) return [];

  const confirmedSentenceIds = new Set(
    analyses
      .filter((analysis) => analysis.vocabularyReviewStatus === 'confirmed')
      .map((analysis) => analysis.sentenceId),
  );
  if (confirmedSentenceIds.size === 0) return [];

  const audioBySentenceId = new Map<string, SentenceAudio>();
  for (const audio of audioRows) {
    if (!audioBySentenceId.has(audio.sentenceId)) audioBySentenceId.set(audio.sentenceId, audio);
  }

  const bookIdBySentenceId = new Map<string, string>();
  for (const membership of bookSentences) {
    if (suspendedIndex && membershipIsShelved(membership, suspendedIndex)) continue;
    if (!bookIdBySentenceId.has(membership.sentenceId)) {
      bookIdBySentenceId.set(membership.sentenceId, membership.bookId);
    }
  }

  const pitchCarryingItemById = new Map(
    vocabularyItems
      .filter((row): row is VocabularyItem => Boolean(row))
      .filter((row) => (row.pitchAccentPositions?.length ?? 0) > 0)
      .map((row) => [row.id, row]),
  );
  if (pitchCarryingItemById.size === 0) return [];

  const sentenceById = new Map(
    sentences.filter((row): row is Sentence => Boolean(row)).map((row) => [row.id, row]),
  );

  const result: PitchAccentMinimalPairOccurrence[] = [];
  for (const link of links) {
    if (!link.surfaceForm || !confirmedSentenceIds.has(link.sentenceId)) continue;
    const item = pitchCarryingItemById.get(link.vocabularyItemId);
    if (!item || link.surfaceForm !== item.expression) continue;
    const audio = audioBySentenceId.get(link.sentenceId);
    const sentence = sentenceById.get(link.sentenceId);
    const bookId = bookIdBySentenceId.get(link.sentenceId);
    if (!audio || !sentence || !bookId) continue;
    result.push({
      vocabularyItemId: item.id,
      expression: item.expression,
      reading: item.reading,
      meaning: item.meaning,
      position: item.pitchAccentPositions![0]!,
      surfaceForm: link.surfaceForm,
      sentence,
      audio,
      bookId,
    });
  }
  return result;
}

/**
 * Up to 5 playable same/different near-minimal-pair trials
 * (`findMinimalPairContrasts`/`buildMinimalPairTrials`) built from
 * `getPitchAccentMinimalPairOccurrences`. Thin composition kept separate
 * from the pure builder so the matching logic stays unit-testable without
 * Dexie.
 */
export async function getPitchAccentMinimalPairTrials(): Promise<
  MinimalPairTrial<PitchAccentMinimalPairOccurrence>[]
> {
  const occurrences = await getPitchAccentMinimalPairOccurrences();
  if (occurrences.length === 0) return [];
  const contrasts = findMinimalPairContrasts(occurrences);
  return buildMinimalPairTrials(contrasts, occurrences);
}


/**
 * Logs one take on the free, ungated pitch-accent production drill
 * (`PitchAccentDrillPage`) — one row per scored target word per recording.
 * Append-only, sync-conflict-free like `recordReview`. Purely a
 * usage/effectiveness log: never gates or reorders the drill itself.
 */
export async function logPitchDrillAttempt(input: {
  mode: 'sentence' | 'word';
  vocabularyItemId?: string;
  surfaceForm: string;
  reading: string;
  contextSentenceId: string;
  measured: boolean;
  mismatch: boolean;
  confidence?: 'low' | 'medium' | 'high';
  expectedShape?: string;
  measuredShape?: string;
  focusTriggered: boolean;
  fallTimingErrorMorae?: number;
  fallMagnitudeRatio?: number;
  now?: Date;
}): Promise<PitchDrillAttempt> {
  const db = getDb();
  const attempt: PitchDrillAttempt = {
    id: createId('pitch_drill'),
    timestamp: (input.now ?? new Date()).toISOString(),
    mode: input.mode,
    vocabularyItemId: input.vocabularyItemId,
    surfaceForm: input.surfaceForm,
    reading: input.reading,
    contextSentenceId: input.contextSentenceId,
    measured: input.measured,
    mismatch: input.mismatch,
    confidence: input.confidence,
    expectedShape: input.expectedShape,
    measuredShape: input.measuredShape,
    focusTriggered: input.focusTriggered,
    fallTimingErrorMorae: input.fallTimingErrorMorae,
    fallMagnitudeRatio: input.fallMagnitudeRatio,
  };
  await db.pitchDrillAttempts.put(attempt);
  notifySyncMany([
    { entity: 'pitch_drill_attempts', recordId: attempt.id, payload: attempt },
  ]);
  return attempt;
}


/**
 * What today's "Daily practice" panel counts (`src/lib/dailyPractice.ts`):
 * scored pitch-drill words and finished game rounds since local midnight.
 * Both are logs the activities already write, so the panel needs no state of
 * its own. Both `gameRounds` and `pitchDrillAttempts` sync, so the counts
 * include rounds from other devices once they have arrived.
 */
export async function getDailyPracticeCounts(
  now: Date = new Date(),
): Promise<{ pitchDrillTakes: number }> {
  const start = startOfLocalDayIso(now);
  return { pitchDrillTakes: await getDb().pitchDrillAttempts.where('timestamp').aboveOrEqual(start).count() };
}


/**
 * Alignments for many recordings at once: the local Dexie cache first, then
 * one bulk Supabase query for whatever's missing (written back locally, so
 * this is a one-off cost per device). Never throws; ids with no usable
 * alignment are simply absent from the result. Unlike `loadOrComputeAlignment`
 * this never falls through to the tailnet MFA service — that needs the audio
 * blob and would mean aligning dozens of clips just to size a game's pool.
 */
export async function loadAlignmentsBulk(audioIds: string[]): Promise<Map<string, AlignmentResult>> {
  const db = getDb();
  const found = new Map<string, AlignmentResult>();
  if (audioIds.length === 0) return found;
  const rows = await db.referenceAlignments.bulkGet(audioIds);
  const missing: string[] = [];
  audioIds.forEach((id, index) => {
    const row = rows[index];
    if (row && row.alignmentVersion === ALIGNMENT_VERSION) found.set(id, row.result);
    else missing.push(id);
  });
  if (missing.length === 0) return found;
  try {
    const { fetchRemoteAlignments } = await import('../../sync/alignmentRemote');
    const remote = await fetchRemoteAlignments(missing);
    for (const [id, result] of remote) {
      found.set(id, result);
      await saveReferenceAlignment(id, result);
    }
  } catch {
    // Offline / Supabase not configured — play with what's cached.
  }
  return found;
}

/**
 * A noun never inflects, so if `isolatedWordSpans` had to widen the match
 * past the citation form's own characters (`!tokenExact`), the extra content
 * is a fused neighbour the aligner's dictionary never learned to split off —
 * an honorific suffix glued to a name/noun (皆さん for a 皆-only link), a
 * compound — not legitimately part of this word's audio (card issue: a 皆
 * citation-form clip played the whole "みなさん", not "みな"). Verbs and
 * adjectives deliberately keep the wider token (their conjugated ending
 * carries the pitch cue this game/drill is testing), so this only tightens
 * the check for confirmed nouns.
 */
function isTrustworthyCitationSpan(item: VocabularyItem, spans: IsolatedWordSpans): boolean {
  if (!item.partOfSpeech?.startsWith('名詞')) return true;
  return spans.tokenExact;
}

export interface PitchWordClipWithAudio extends PitchWordClip {
  audio: SentenceAudio;
  sentence: Sentence;
  surfaceForm: string;
}

/**
 * Word-only pitch clips for the pitch drill and contrast examples: a confirmed,
 * citation-form occurrence of a word with a dictionary pitch position and 2+
 * morae, whose *word alone* can be cut out of its reference recording by a
 * **current-version** forced alignment (manual/backfilled `audioStartMs/EndMs`
 * ranges are ignored — they usually include the following particle; a
 * hand-corrected `wordOnlyStartMs/EndMs` is used instead when present) with a
 * plausible length. One clip per word per book, skipping sentences that live
 * only in suspended books. A sentence with a digit+日/月 date plays normally —
 * the aligner's date expansion is accounted for in the span mapping (see
 * `alignerView`). Read-only apart from caching alignments locally.
 * Proficiency is deliberately not required.
 */
export async function getPitchWordClips(): Promise<{ clips: PitchWordClipWithAudio[] }> {
  const db = getDb();
  const [allLinks, suspendedIndex] = await Promise.all([db.sentenceVocabulary.toArray(), loadSuspendedBookIndex()]);
  let links = allLinks.filter(
    (link) =>
      !!link.surfaceForm &&
      !(suspendedIndex && sentenceIsSuspendedOnly(link.sentenceId, suspendedIndex)),
  );
  if (links.length > 0) {
    const introduced = await filterToIntroducedSentenceIds(links.map((link) => link.sentenceId));
    links = links.filter((link) => introduced.has(link.sentenceId));
  }
  if (links.length === 0) return { clips: [] };

  const sentenceIds = [...new Set(links.map((link) => link.sentenceId))];
  const [items, sentences, audioRows, memberships] = await Promise.all([
    db.vocabularyItems.bulkGet([...new Set(links.map((link) => link.vocabularyItemId))]),
    db.sentences.bulkGet(sentenceIds),
    db.sentenceAudio.where('sentenceId').anyOf(sentenceIds).toArray(),
    db.bookSentences.where('sentenceId').anyOf(sentenceIds).toArray(),
  ]);
  const itemById = new Map(
    items
      .filter((row): row is VocabularyItem => Boolean(row))
      .filter((row) => (row.pitchAccentPositions?.length ?? 0) > 0)
      .map((row) => [row.id, row]),
  );
  const sentenceById = new Map(
    sentences.filter((row): row is Sentence => Boolean(row)).map((row) => [row.id, row]),
  );
  const audioBySentenceId = new Map<string, SentenceAudio>();
  for (const audio of audioRows) {
    if (!audioBySentenceId.has(audio.sentenceId)) audioBySentenceId.set(audio.sentenceId, audio);
  }
  const membershipBySentenceId = new Map<string, BookSentence>();
  for (const membership of memberships) {
    const current = membershipBySentenceId.get(membership.sentenceId);
    const shelved = suspendedIndex ? membershipIsShelved(membership, suspendedIndex) : false;
    if (!current || (!shelved && suspendedIndex && membershipIsShelved(current, suspendedIndex))) {
      membershipBySentenceId.set(membership.sentenceId, membership);
    }
  }

  // One occurrence per (word, book), citation form only, with audio.
  const chosen = new Map<string, { link: SentenceVocabulary; item: VocabularyItem }>();
  for (const link of links) {
    const item = itemById.get(link.vocabularyItemId);
    const bookId = membershipBySentenceId.get(link.sentenceId)?.bookId;
    if (!item || !bookId || link.surfaceForm !== item.expression) continue;
    if (!audioBySentenceId.has(link.sentenceId) || !sentenceById.has(link.sentenceId)) continue;
    const key = `${item.id}:${bookId}`;
    if (!chosen.has(key)) chosen.set(key, { link, item });
  }

  const alignments = await loadAlignmentsBulk(
    [...chosen.values()].map(({ link }) => audioBySentenceId.get(link.sentenceId)!.id),
  );

  const clips: PitchWordClipWithAudio[] = [];
  for (const [key, { link, item }] of chosen) {
    const audio = audioBySentenceId.get(link.sentenceId)!;
    const sentence = sentenceById.get(link.sentenceId)!;
    const shape = inWordShape(item.reading, item.pitchAccentPositions![0]!);
    if (!shape) continue;
    // Deliberately NOT `link.audioStartMs/EndMs`: those overrides are meant for
    // the pitch/word-listening cards, and the boundary backfill
    // (`backfill-word-audio-range.ts`) writes the aligner's raw match, which
    // *includes a following particle* (71 of the 92 comparable overrides in
    // prod end at word+particle). A clip with the particle in it carries the
    // heiban/odaka cue a word-only clip must leave out, so only the strict
    // word-only span from a current-version alignment — or a hand-corrected
    // `wordOnlyStartMs/EndMs` — is safe here.
    const wordOnlyOverride =
      link.wordOnlyStartMs != null && link.wordOnlyEndMs != null
        ? { startMs: link.wordOnlyStartMs, endMs: link.wordOnlyEndMs }
        : null;
    const alignment = alignments.get(audio.id);
    const spans = wordOnlyOverride
      ? { wordOnly: wordOnlyOverride, withParticle: null, tokenExact: true }
      : alignment
        ? isolatedWordSpans(alignment.words, sentence.japanese, link.surfaceForm!)
        : null;
    const span: TimeRangeMs | null =
      spans && isTrustworthyCitationSpan(item, spans) ? spans.wordOnly : null;
    if (!span || !isPlausibleClipSpan(span)) continue;
    clips.push({
      linkId: link.id,
      vocabularyItemId: item.id,
      expression: item.expression,
      reading: item.reading,
      meaning: item.meaning ?? '',
      position: item.pitchAccentPositions![0]!,
      moraCount: shape.moraCount,
      shape: shape.shape,
      bookId: key.slice(item.id.length + 1),
      span,
      audio,
      sentence,
      surfaceForm: link.surfaceForm!,
    });
  }
  return { clips };
}

export interface PitchAccentSpeakerClip {
  bookId: string;
  bookTitle: string;
  audio: SentenceAudio;
  sentence: Sentence;
  span: TimeRangeMs;
}

export interface PitchAccentSpeakerComparison {
  vocabularyItem: VocabularyItem;
  clips: PitchAccentSpeakerClip[];
}

/**
 * Words with a dictionary pitch-accent position that were also mined, in
 * citation form, out of 2+ distinct books — the app's "same speaker" proxy
 * (see `getPitchAccentMinimalPairOccurrences`'s doc: a book is normally one
 * show/narrator, not verified per-clip identity). Lets a learner compare how
 * different recordings realize the same word's accent, side by side against
 * the dictionary pattern, rather than drilling one clip in isolation.
 *
 * Same eligibility rule as `getPitchWordClips` (citation-form link, current-
 * version forced alignment, plausible word-only span, non-suspended book),
 * minus its accent-shape/mora-count restriction — this is a browse tool, not a drill, so single-mora and
 * shapeless words are still worth showing.
 */
export async function getPitchAccentSpeakerComparisons(): Promise<PitchAccentSpeakerComparison[]> {
  const db = getDb();
  const [allLinks, suspendedIndex, books] = await Promise.all([
    db.sentenceVocabulary.toArray(),
    loadSuspendedBookIndex(),
    db.books.toArray(),
  ]);
  let links = allLinks.filter(
    (link) =>
      !!link.surfaceForm &&
      !(suspendedIndex && sentenceIsSuspendedOnly(link.sentenceId, suspendedIndex)),
  );
  if (links.length > 0) {
    const introduced = await filterToIntroducedSentenceIds(links.map((link) => link.sentenceId));
    links = links.filter((link) => introduced.has(link.sentenceId));
  }
  if (links.length === 0) return [];

  const sentenceIds = [...new Set(links.map((link) => link.sentenceId))];
  const [items, sentences, audioRows, memberships] = await Promise.all([
    db.vocabularyItems.bulkGet([...new Set(links.map((link) => link.vocabularyItemId))]),
    db.sentences.bulkGet(sentenceIds),
    db.sentenceAudio.where('sentenceId').anyOf(sentenceIds).toArray(),
    db.bookSentences.where('sentenceId').anyOf(sentenceIds).toArray(),
  ]);
  const itemById = new Map(
    items
      .filter((row): row is VocabularyItem => Boolean(row))
      .filter((row) => (row.pitchAccentPositions?.length ?? 0) > 0)
      .map((row) => [row.id, row]),
  );
  const sentenceById = new Map(
    sentences.filter((row): row is Sentence => Boolean(row)).map((row) => [row.id, row]),
  );
  const audioBySentenceId = new Map<string, SentenceAudio>();
  for (const audio of audioRows) {
    if (!audioBySentenceId.has(audio.sentenceId)) audioBySentenceId.set(audio.sentenceId, audio);
  }
  const membershipBySentenceId = new Map<string, BookSentence>();
  for (const membership of memberships) {
    const current = membershipBySentenceId.get(membership.sentenceId);
    const shelved = suspendedIndex ? membershipIsShelved(membership, suspendedIndex) : false;
    if (!current || (!shelved && suspendedIndex && membershipIsShelved(current, suspendedIndex))) {
      membershipBySentenceId.set(membership.sentenceId, membership);
    }
  }
  const bookTitleById = new Map(books.map((book) => [book.id, book.title]));

  // One occurrence per (word, book), citation form only, with audio.
  const chosen = new Map<string, { link: SentenceVocabulary; item: VocabularyItem; bookId: string }>();
  for (const link of links) {
    const item = itemById.get(link.vocabularyItemId);
    const bookId = membershipBySentenceId.get(link.sentenceId)?.bookId;
    if (!item || !bookId || link.surfaceForm !== item.expression) continue;
    if (!audioBySentenceId.has(link.sentenceId) || !sentenceById.has(link.sentenceId)) continue;
    const key = `${item.id}:${bookId}`;
    if (!chosen.has(key)) chosen.set(key, { link, item, bookId });
  }

  const alignments = await loadAlignmentsBulk(
    [...chosen.values()].map(({ link }) => audioBySentenceId.get(link.sentenceId)!.id),
  );

  const clipsByItem = new Map<string, PitchAccentSpeakerClip[]>();
  const itemsSeen = new Map<string, VocabularyItem>();
  for (const { link, item, bookId } of chosen.values()) {
    const audio = audioBySentenceId.get(link.sentenceId)!;
    const sentence = sentenceById.get(link.sentenceId)!;
    // Same strict word-only span as `getPitchWordClips` (comparing accent shapes
    // across speakers also breaks if a particle sneaks in), so an existing
    // hand-corrected word-only span carries over here too.
    const wordOnlyOverride =
      link.wordOnlyStartMs != null && link.wordOnlyEndMs != null
        ? { startMs: link.wordOnlyStartMs, endMs: link.wordOnlyEndMs }
        : null;
    const alignment = alignments.get(audio.id);
    const spans = wordOnlyOverride
      ? { wordOnly: wordOnlyOverride, withParticle: null, tokenExact: true }
      : alignment
        ? isolatedWordSpans(alignment.words, sentence.japanese, link.surfaceForm!)
        : null;
    const span: TimeRangeMs | null =
      spans && isTrustworthyCitationSpan(item, spans) ? spans.wordOnly : null;
    if (!span || !isPlausibleClipSpan(span)) continue;
    const list = clipsByItem.get(item.id) ?? [];
    list.push({ bookId, bookTitle: bookTitleById.get(bookId) ?? 'Unknown book', audio, sentence, span });
    clipsByItem.set(item.id, list);
    itemsSeen.set(item.id, item);
  }

  const result: PitchAccentSpeakerComparison[] = [];
  for (const [itemId, clips] of clipsByItem) {
    if (new Set(clips.map((clip) => clip.bookId)).size < 2) continue;
    clips.sort((a, b) => a.bookTitle.localeCompare(b.bookTitle));
    result.push({ vocabularyItem: itemsSeen.get(itemId)!, clips });
  }
  result.sort(
    (a, b) =>
      b.clips.length - a.clips.length ||
      a.vocabularyItem.expression.localeCompare(b.vocabularyItem.expression, 'ja'),
  );
  return result;
}


export interface VocabularyOccurrenceCandidate {
  link: SentenceVocabulary;
  vocabularyItem: VocabularyItem;
  sentence: Sentence;
  surfaceForm: string;
}

/**
 * Like `getVocabularyTargetCandidates`, but one entry per *occurrence* (per
 * `surfaceForm`-bearing `sentence_vocabulary` link) rather than one per
 * distinct word. The contextual conjugation card (docs/STATUS.md) schedules
 * a separate study item for each occurrence — a verb read in three sentences
 * is three cards — so it needs every link, not just the first per word.
 * Still bounded: only surface-form-bearing links, only within `sentenceIds`.
 */
export async function getVocabularyOccurrenceCandidates(
  sentenceIds: string[],
): Promise<VocabularyOccurrenceCandidate[]> {
  if (sentenceIds.length === 0) return [];
  const db = getDb();
  const links = (
    await db.sentenceVocabulary.where('sentenceId').anyOf(sentenceIds).toArray()
  ).filter((link) => !!link.surfaceForm);
  if (links.length === 0) return [];

  const [vocabularyItems, sentences] = await Promise.all([
    db.vocabularyItems.bulkGet(links.map((link) => link.vocabularyItemId)),
    db.sentences.bulkGet(links.map((link) => link.sentenceId)),
  ]);

  const candidates: VocabularyOccurrenceCandidate[] = [];
  links.forEach((link, index) => {
    const vocabularyItem = vocabularyItems[index];
    const sentence = sentences[index];
    if (!vocabularyItem || !sentence || !link.surfaceForm) return;
    candidates.push({ link, vocabularyItem, sentence, surfaceForm: link.surfaceForm });
  });
  return candidates;
}

/**
 * Per-word pitch-accent targets for the ambient "H/L marks" display
 * (SentencePitchAccentRow, AnalysisPanel, SyncedShadowText) — like
 * getVocabularyTargetCandidates but inflection-aware: each occurrence goes
 * through resolveInflectedPitchAccent (src/lib/pitchAccentShift.ts) so a
 * word appearing inflected (走らない for 走る) contributes the *conjugated*
 * reading/position it's actually pronounced with, not the dictionary one.
 * An occurrence resolveInflectedPitchAccent can't confidently place (no
 * accent data, or an inflected form outside its narrow coverage) is
 * dropped rather than shown with a wrong contour — same "skip, don't
 * guess" stance as everywhere else in this feature. Content words with no
 * vocabulary link then fall back to the Kanjium table
 * (src/lib/kanjiumPitchLookup.ts), citation forms only.
 */
export async function getSentencePitchAccentTargets(
  sentenceId: string,
): Promise<SentencePitchAccentTarget[]> {
  const occurrences = await getVocabularyOccurrenceCandidates([sentenceId]);
  const targets: SentencePitchAccentTarget[] = [];
  for (const occurrence of occurrences) {
    const resolved = resolveInflectedPitchAccent(occurrence);
    if (!resolved) continue;
    targets.push({
      // resolved.surfaceForm, not occurrence.surfaceForm — see the doc
      // comment on ResolvedPitchAccent.surfaceForm (truncated stems).
      surfaceForm: resolved.surfaceForm,
      reading: resolved.reading,
      // A citation-form word keeps the dictionary's other listed accents so the row can flag the ambiguity;
      // an inflected occurrence is a single predicted position.
      pitchAccentPositions: resolved.isCitationForm
        ? [resolved.position, ...(occurrence.vocabularyItem.pitchAccentPositions ?? []).slice(1)]
        : [resolved.position],
    });
  }
  // Words with no vocabulary link: fall back to the Kanjium table (citation-form content words only).
  const sentence = await getDb().sentences.get(sentenceId);
  const lookup = sentence?.vocabularySuggestions?.length ? await loadKanjiumPitchLookup() : null;
  if (sentence && lookup) {
    const covered = new Set(targets.map((target) => target.surfaceForm));
    targets.push(
      ...kanjiumTargetsForSuggestions(sentence.vocabularySuggestions, lookup, covered, sentence),
    );
  }
  return targets;
}

export interface TrackedGrammarSpan {
  surfaceForm: string;
  start: number;
  end: number;
  patternName: string;
}

/**
 * For each of `sentenceIds`, its first tracked (`confirmedByLearner`) grammar
 * occurrence with a real character span — ambient "you're tracking this
 * pattern too" highlighting for `reading_in_context`'s passage context lines
 * (docs/ROADMAP.md "Ambient connective tissue in the reveal"), not the
 * target sentence itself, which is under test. One span per sentence: a
 * context line highlighting every occurrence at once would be visual noise,
 * and this is reinforcement, not a review.
 */
export async function getTrackedGrammarSpansForSentences(
  sentenceIds: string[],
): Promise<Map<string, TrackedGrammarSpan>> {
  const result = new Map<string, TrackedGrammarSpan>();
  if (sentenceIds.length === 0) return result;
  const db = getDb();
  const links = await db.sentenceGrammar.where('sentenceId').anyOf(sentenceIds).toArray();
  const firstBySentence = new Map<string, SentenceGrammar>();
  for (const link of links) {
    if (!link.confirmedByLearner || link.start == null || link.end == null) continue;
    if (!firstBySentence.has(link.sentenceId)) firstBySentence.set(link.sentenceId, link);
  }
  if (firstBySentence.size === 0) return result;
  const patterns = await db.grammarPatterns.bulkGet([
    ...new Set([...firstBySentence.values()].map((link) => link.grammarPatternId)),
  ]);
  const patternById = new Map(
    patterns.filter((pattern): pattern is GrammarPattern => !!pattern).map((pattern) => [pattern.id, pattern]),
  );
  for (const [sentenceId, link] of firstBySentence) {
    const pattern = patternById.get(link.grammarPatternId);
    if (!pattern) continue;
    result.set(sentenceId, {
      surfaceForm: link.surfaceForm ?? '',
      start: link.start!,
      end: link.end!,
      patternName: pattern.canonicalName,
    });
  }
  return result;
}

/** Canonical (unordered) pair ordering so A↔B is never stored twice. */
function canonicalConfusionPair(
  itemAId: string,
  itemBId: string,
): [string, string] {
  return itemAId < itemBId ? [itemAId, itemBId] : [itemBId, itemAId];
}

/**
 * Get-or-create a confusion pair. Never overwrites an existing row's
 * confusionType — mirrors ensureVocabularyItem/ensureKanji's "never
 * overwrite once created" convention. Use recordConfusionObservation to
 * bump the count on repeated observations.
 */
export async function ensureVocabularyConfusion(
  itemAId: string,
  itemBId: string,
  confusionType: VocabularyConfusionType,
): Promise<VocabularyConfusion> {
  const [a, b] = canonicalConfusionPair(itemAId, itemBId);
  const db = getDb();
  const existing = await db.vocabularyConfusions
    .where('[itemAId+itemBId]')
    .equals([a, b])
    .first();
  if (existing) return existing;

  const timestamp = nowIso();
  const confusion: VocabularyConfusion = {
    id: createId('vocab_confusion'),
    itemAId: a,
    itemBId: b,
    confusionType,
    observedCount: 1,
    lastObservedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.vocabularyConfusions.put(confusion);
  notifySync('vocabulary_confusions', confusion.id, confusion);
  return confusion;
}

/** Record another observation of an already-known (or new) confusion pair. */
export async function recordConfusionObservation(
  itemAId: string,
  itemBId: string,
  confusionType: VocabularyConfusionType,
): Promise<VocabularyConfusion> {
  const [a, b] = canonicalConfusionPair(itemAId, itemBId);
  const db = getDb();
  const existing = await db.vocabularyConfusions
    .where('[itemAId+itemBId]')
    .equals([a, b])
    .first();
  const timestamp = nowIso();
  const updated: VocabularyConfusion = existing
    ? {
        ...existing,
        observedCount: existing.observedCount + 1,
        lastObservedAt: timestamp,
        updatedAt: timestamp,
      }
    : {
        id: createId('vocab_confusion'),
        itemAId: a,
        itemBId: b,
        confusionType,
        observedCount: 1,
        lastObservedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
  await db.vocabularyConfusions.put(updated);
  notifySync('vocabulary_confusions', updated.id, updated);
  return updated;
}

export interface ConfusionPairCandidate {
  confusion: VocabularyConfusion;
  itemA: VocabularyTargetCandidate;
  itemB: VocabularyTargetCandidate;
}

