import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { KaraokeSentenceText } from '../components/KaraokeSentenceText';
import { MeasuredPitchContour } from '../components/MeasuredPitchContour';
import { NativeAudioButton } from '../components/NativeAudioButton';
import { PitchAccentDiagram } from '../components/PitchAccentDiagram';
import { PitchAccentNativeAudio } from '../components/PitchAccentNativeAudio';
import { SegmentLoopPlayer } from '../components/SegmentLoopPlayer';
import { SentencePitchAccentRow } from '../components/SentencePitchAccentRow';
import { VocabChips } from '../components/VocabChips';
import {
  countReviewsSince,
  deferUnreadyGrammarReviews,
  deferUnreadySentenceReviews,
  ensureGrammarStudyItem,
  ensureStudyItem,
  ensureVocabularyStudyItem,
  getConfusionPairCandidates,
  getDb,
  getDueStudyItems,
  getReferencePitchTrack,
  saveReferencePitchTrack,
  getProficientVocabularyItemIds,
  getSentenceFullReviewReadiness,
  getSentenceListeningReadiness,
  getVocabularyOccurrenceCandidates,
  getVocabularyTargetCandidates,
  pickContextSentenceForGrammarPattern,
  readSettings,
  recordReview,
  reportCardIssue,
  settleSessionStep,
  type ConfusionPairCandidate,
  type VocabularyOccurrenceCandidate,
  type VocabularyTargetCandidate,
} from '../db/repository';
import { useActiveSession } from '../hooks/useActiveSession';
import { sessionStepTargetPath } from '../lib/sessionPlanner';
import type {
  Book,
  GrammarPattern,
  ReviewAssistance,
  ReviewRating,
  Sentence,
  SentenceAudio,
  StudyActivityType,
  StudyItem,
  VocabularyItem,
} from '../domain/types';
import {
  conjugate,
  conjugationWordClassFromPartOfSpeech,
  identifyConjugationForm,
  type ConjugationForm,
  type ConjugationWordClass,
} from '../lib/conjugation';
import {
  blankPatternInSentence,
  buildGrammarCompletionChoices,
  grammarPatternUsedIn,
} from '../lib/grammarPatterns';
import { buildReadingContextMap, type ReadingContext } from '../lib/readingContext';
import { isVocabularyItemProficient } from '../lib/scheduling';
import { segmentIntoMorae } from '../lib/mora';
import type { PitchAnalysisPayload } from '../lib/pitch';
import { explainPitchAccent } from '../lib/pitchAccentRules';
import { loadOrComputeReferencePitch } from '../lib/referencePitchCache';
import {
  expectedPitchShape,
  pitchPatternLabel,
  type PitchAccentPattern,
} from '../lib/pitchAccentShape';
import { isReadingAnswerCorrect, surfaceReadingFromInline } from '../lib/readingAnswer';
import { PLAYBACK_SPEEDS } from '../lib/recording';

/**
 * Phase 4 (docs/UNIFIED_APP_ARCHITECTURE.md §10) starts with two
 * sentence-subject activity types. Both reveal EN + vocab and are
 * self-rated; they differ in the pre-reveal framing — `comprehension`
 * shows the sentence in isolation, `reading_in_context` embeds it in its
 * surrounding passage (see ReadingInContextCard / buildReadingContextMap).
 */
const SENTENCE_ACTIVITY_TYPES: StudyActivityType[] = [
  'comprehension',
  'reading_in_context',
];

/**
 * Vocabulary-item-subject activity types (Phase 7.2/7.3/7.9, docs/STATUS.md) —
 * all three target a specific occurrence of a word in one of its sentences,
 * and so share one eligibility condition and candidate source (see
 * getVocabularyTargetCandidates): a surfaceForm-bearing sentence_vocabulary
 * link. Vocabulary confirmed before that field existed, or imported outside
 * the picker, isn't a candidate for any of them yet. `reading_retrieval`
 * shows the word (hides the reading); `cloze` hides the word entirely;
 * `reading_production` (Phase 7.9, docs brief §12) shows the word and asks
 * the learner to type the reading — recognition vs. production is a
 * separate axis from what's hidden, so this is a third, harder rung on the
 * same word rather than a variant of reading_retrieval.
 */
const VOCABULARY_ACTIVITY_TYPES: StudyActivityType[] = [
  'reading_retrieval',
  'cloze',
  'reading_production',
];

/**
 * Audio comprehension (Phase 7.4, docs/STATUS.md) — sentence-subject, like
 * `comprehension`/`reading_in_context`, but only eligible for sentences
 * that have at least one `SentenceAudio` row; the Japanese text stays
 * hidden until reveal, audio plays first.
 */
const AUDIO_ACTIVITY_TYPES: StudyActivityType[] = ['listening'];

/**
 * Word-in-context listening (user request): subjectType `sentenceVocabulary`,
 * subjectId a `SentenceVocabulary.id` — one card per surface-form occurrence
 * of a word in a sentence that has reference audio, like the contextual
 * conjugation card. Reworked 2026-09-02 into an audio cloze: the whole
 * sentence is played, then shown with the target word blanked (+ its
 * translation) for the learner to recall from sound + context — see
 * WordListeningCard. A two-tier listening ladder: these are gated behind the
 * word's own reading proficiency (tier 1, ActivityDescriptor.isReady →
 * getProficientVocabularyItemIds), and in turn the full-sentence `listening`
 * card is gated behind *these* (tier 2, getSentenceListeningReadiness) — so
 * the learner has parsed every content word inside its clause before being
 * asked to parse the whole clip cold.
 */
const WORD_LISTENING_ACTIVITY_TYPES: StudyActivityType[] = ['word_listening'];

/**
 * Contrastive pair review (Phase 7.7, docs brief §10): subjectType
 * `vocabularyConfusion`, subjectId a VocabularyConfusion.id — one study item
 * per pair, not per word, so FSRS scheduling reflects "can this learner tell
 * these two apart" rather than either word's individual recall (that's
 * already covered by reading_retrieval/cloze). Eligibility is handled by
 * getConfusionPairCandidates (both members must be vocabulary-target
 * candidates in scope); see docs/STATUS.md.
 */
const CONFUSION_ACTIVITY_TYPES: StudyActivityType[] = ['contrastive'];

/**
 * Contextual conjugation (docs/STATUS.md — supersedes the Phase 7.9b
 * "sentence transformation" design and its per-word-hash follow-up). One
 * card per *occurrence* of a conjugable word in a sentence — subjectType
 * `sentenceVocabulary`, subjectId a `SentenceVocabulary.id` — quizzing the
 * form that sentence actually uses. A verb read in a te-form sentence and a
 * conditional sentence gets one card for each; a form never encountered is
 * never drilled. The `activityType` string stays `'sentence_transformation'`
 * (so `classifyReviewError`, the session planner's practice pool, and
 * `ACTIVITY_LABELS` keep working unchanged). Eligibility: `partOfSpeech`
 * maps to a conjugation word class *and* `identifyConjugationForm`
 * (src/lib/conjugation.ts) recognizes the surface as exactly one form —
 * stacked/compound surfaces (話している, 食べられなかった) get no card. See
 * getSentenceConjugationCandidates.
 */
const CONJUGATION_ACTIVITY_TYPES: StudyActivityType[] = ['sentence_transformation'];

/**
 * Pitch-accent review (docs/STATUS.md): subjectType stays `vocabularyItem`,
 * like reading_retrieval/cloze/reading_production —
 * but eligibility is narrower still: only words with dictionary-backed
 * `pitchAccentPositions` data (Kanjium, via
 * scripts/backfill-pitch-accent.ts — a subset of confirmed vocabulary, not
 * all of it) *and* whose context sentence has a native reference recording
 * to model the accent — a dictionary-contour-only card was judged not
 * worth its slot in the queue (docs/STATUS.md), and here the native clip
 * is load-bearing: it is what the learner listens to before answering.
 * Audio-first perception task — loop the native word, then mark where the
 * pitch drops on the word's own morae (choices 0..moraCount). See
 * getPitchAccentReviewCandidates below.
 */
const PITCH_ACCENT_ACTIVITY_TYPES: StudyActivityType[] = ['pitch_accent'];

/**
 * Grammar-pattern review (grammar-learning system Phase 5, docs/STATUS.md):
 * subjectType `grammarPattern`, subjectId a GrammarPattern.id. Unlike every
 * other category above, this one is never lazily seeded by ReviewPage
 * itself — a grammarPattern study item only ever comes from an explicit
 * "Track" in GrammarPicker (src/components/GrammarPicker.tsx), which seeds
 * both activity types together. `candidates` below is therefore built from
 * *already-tracked* patterns only (not "every pattern in scope"), so the
 * generic pending-seed pool naturally seeds nothing new for this
 * descriptor — it only catches an older-Track pattern that's missing one of
 * the two types (see buildActivityDescriptors). Global scope only (no
 * bookId): a pattern isn't really "of" one book the way a sentence is.
 */
const GRAMMAR_ACTIVITY_TYPES: StudyActivityType[] = [
  'grammar_comprehension',
  'grammar_completion',
];

/**
 * Grammar contrast (grammar-learning system Phase 9 slice, design brief
 * §11C — "can you tell these two apart," not just recall the right one
 * from an open pool): a separate descriptor from GRAMMAR_ACTIVITY_TYPES
 * above because its eligibility is narrower still — a candidate only
 * exists for a tracked pattern that also has at least one
 * `GrammarRelationship` (created via the detail page's "Related patterns"
 * picker), not every tracked pattern. Unlike grammar_comprehension/
 * grammar_completion, this genuinely *can* get lazily seeded by
 * ReviewPage's generic pending-seed pool the first time a relationship
 * makes a candidate available for an already-tracked pattern — that's
 * intentional and mirrors the existing "catches an older-Track pattern
 * missing one of the [other] types" backfill behavior GRAMMAR_ACTIVITY_
 * TYPES's own doc comment describes, just triggered by a relationship
 * appearing instead of a Track click.
 */
const GRAMMAR_CONTRAST_ACTIVITY_TYPES: StudyActivityType[] = ['grammar_contrast'];

/**
 * Grammar production (docs/ROADMAP.md "Grammar production ladder"): the
 * grammar system otherwise stops at recognition
 * (comprehension/completion/contrast) while the vocabulary side has a real
 * production ladder. This card shows the pattern's meaning and asks the
 * learner to *write* a sentence using it, then reveals a model (one of
 * their own tagged encounters) to self-rate against. Eligibility is
 * narrower than plain grammar review: only a tracked pattern whose
 * `grammar_comprehension` study item has itself reached FSRS proficiency
 * (learner state `recognized` or better — production comes after
 * recognition, mirroring reading_retrieval → reading_production). Like
 * grammar_contrast it *can* be lazily seeded by the generic pending-seed
 * pool once a pattern crosses that bar. Global scope only.
 */
const GRAMMAR_PRODUCTION_ACTIVITY_TYPES: StudyActivityType[] = ['grammar_production'];

const ACTIVITY_LABELS: Record<string, string> = {
  comprehension: 'Comprehension',
  reading_in_context: 'Reading in context',
  reading_retrieval: 'Reading retrieval',
  cloze: 'Cloze',
  reading_production: 'Reading production',
  listening: 'Listening',
  word_listening: 'Word listening',
  contrastive: 'Contrastive pair',
  sentence_transformation: 'Conjugation in context',
  pitch_accent: 'Pitch accent',
  grammar_comprehension: 'Grammar comprehension',
  grammar_completion: 'Grammar completion',
  grammar_contrast: 'Grammar contrast',
  grammar_production: 'Grammar production',
};

interface SentenceConjugationCandidate {
  link: VocabularyOccurrenceCandidate['link'];
  vocabularyItem: VocabularyItem;
  sentence: Sentence;
  surfaceForm: string;
  wordClass: ConjugationWordClass;
  /** The form this occurrence is in, per identifyConjugationForm. */
  form: ConjugationForm;
  /** Readings accepted as correct — the in-context inflected reading, and the engine's own as a fallback. */
  expectedReadings: string[];
}

/**
 * Pure filter over per-occurrence vocabulary candidates (no DB access) — an
 * occurrence is a candidate only if its `partOfSpeech` maps to a conjugation
 * word class and `identifyConjugationForm` recognizes the surface as exactly
 * one form (i.e. it's a single conjugation step off the dictionary form, not
 * a stacked/compound surface). See CONJUGATION_ACTIVITY_TYPES.
 */
function getSentenceConjugationCandidates(
  occurrences: VocabularyOccurrenceCandidate[],
): SentenceConjugationCandidate[] {
  const result: SentenceConjugationCandidate[] = [];
  for (const occurrence of occurrences) {
    const { vocabularyItem, sentence, surfaceForm } = occurrence;
    const wordClass = conjugationWordClassFromPartOfSpeech(vocabularyItem.partOfSpeech);
    if (!wordClass) continue;
    const inContextReading = surfaceReadingFromInline(sentence.inlineReading, surfaceForm);
    const identified = identifyConjugationForm(
      vocabularyItem.expression,
      vocabularyItem.reading,
      wordClass,
      surfaceForm,
      inContextReading ?? undefined,
    );
    if (!identified) continue;
    const engineReading = conjugate(
      vocabularyItem.expression,
      vocabularyItem.reading,
      wordClass,
      identified.form.key,
    )?.reading;
    const expectedReadings = [...new Set([inContextReading, engineReading].filter(
      (value): value is string => !!value,
    ))];
    if (expectedReadings.length === 0) continue;
    result.push({
      link: occurrence.link,
      vocabularyItem,
      sentence,
      surfaceForm,
      wordClass,
      form: identified.form,
      expectedReadings,
    });
  }
  return result;
}

interface WordListeningCandidate {
  link: VocabularyOccurrenceCandidate['link'];
  vocabularyItem: VocabularyItem;
  sentence: Sentence;
  surfaceForm: string;
  /** The sentence's first reference recording — required (see getWordListeningCandidates). */
  audio: SentenceAudio;
}

/**
 * Pure filter over per-occurrence vocabulary candidates (no DB access) — an
 * occurrence is a word-listening candidate only if its sentence has a
 * reference recording. See WORD_LISTENING_ACTIVITY_TYPES.
 */
function getWordListeningCandidates(
  occurrences: VocabularyOccurrenceCandidate[],
  audioBySentenceId: Map<string, SentenceAudio>,
): WordListeningCandidate[] {
  const result: WordListeningCandidate[] = [];
  for (const occurrence of occurrences) {
    const audio = audioBySentenceId.get(occurrence.sentence.id);
    if (!audio) continue;
    result.push({
      link: occurrence.link,
      vocabularyItem: occurrence.vocabularyItem,
      sentence: occurrence.sentence,
      surfaceForm: occurrence.surfaceForm,
      audio,
    });
  }
  return result;
}

interface PitchAccentReviewCandidate {
  vocabularyItem: VocabularyItem;
  sentence: Sentence;
  surfaceForm: string;
  /** The sentence's first reference recording — required (see getPitchAccentReviewCandidates); powers the card's "loop the native word" control. */
  audio: SentenceAudio;
  /** Mora kana of the dictionary reading — the drop-position choices and the ✓/✗ both key off these. */
  morae: string[];
  /** Dictionary downstep clamped into [0, morae.length]: 0 = heiban/no drop, n = drop right after mora n (n === morae.length is odaka). */
  correctPosition: number;
  /** Category name (平板/頭高/中高/尾高), shown on the reveal only — the buttons ask for a drop position, not this. */
  correctLabel: PitchAccentPattern;
}

/**
 * Pure filter over already-fetched vocabulary-target candidates (no DB
 * access needed), mirroring getSentenceConjugationCandidates's shape —
 * a word is a candidate only if it has dictionary pitch-accent data and a
 * segmentable reading.
 *
 * The card is an audio-first perception task: the learner loops the native
 * realization of the word (see below) and marks *where the pitch drops* on
 * the word's own morae — choices `0..morae.length`, in natural mora order
 * (no shuffle). This both puts the ear before the metalabel and fully
 * specifies the contour: a 4-mora word distinguishes a drop after mora 2
 * from a drop after mora 3, which the old "which of heiban/atamadaka/
 * nakadaka/odaka" multiple choice collapsed.
 *
 * `audioBySentenceId` is the same first-recording-per-sentence map the
 * audio-comprehension candidates use; a matching entry is *required* (like
 * getWordListeningCandidates) — heiban and odaka share the word-internal
 * shape, so a native clip (whose trailing particle disambiguates them by
 * ear) is what makes the card answerable at all.
 *
 * The word must also appear in its *citation form* in this sentence: the
 * choices and the ✓/✗ key off the dictionary reading's morae and downstep,
 * so an inflected occurrence (速く for 速い, ございます for ござる) makes the
 * looped audio's mora count and accent disagree with the "correct" answer —
 * unanswerable by ear. Same reason line ~1650 skips the ambient
 * SentencePitchAccentRow for `sentence_transformation`.
 */
function getPitchAccentReviewCandidates(
  candidates: VocabularyTargetCandidate[],
  audioBySentenceId: Map<string, SentenceAudio>,
): PitchAccentReviewCandidate[] {
  const result: PitchAccentReviewCandidate[] = [];
  for (const candidate of candidates) {
    const positions = candidate.vocabularyItem.pitchAccentPositions;
    if (!positions?.length) continue;
    const audio = audioBySentenceId.get(candidate.sentence.id);
    if (!audio) continue;
    // Citation form only — accept a kana/kanji spelling difference (via the
    // in-context reading where `inlineReading` is present) but not inflection.
    const dictionaryReading = candidate.vocabularyItem.reading;
    const inContextReading = surfaceReadingFromInline(
      candidate.sentence.inlineReading,
      candidate.surfaceForm,
    );
    const isCitationForm =
      candidate.surfaceForm === candidate.vocabularyItem.expression ||
      candidate.surfaceForm === dictionaryReading ||
      inContextReading === dictionaryReading;
    if (!isCitationForm) continue;
    const morae = segmentIntoMorae(dictionaryReading).map((unit) => unit.text);
    if (morae.length === 0) continue;
    const correctPosition = Math.max(0, Math.min(positions[0]!, morae.length));
    result.push({
      vocabularyItem: candidate.vocabularyItem,
      sentence: candidate.sentence,
      surfaceForm: candidate.surfaceForm,
      audio,
      morae,
      correctPosition,
      correctLabel: pitchPatternLabel(positions[0]!, morae.length),
    });
  }
  return result;
}

const RATINGS: { value: ReviewRating; label: string }[] = [
  { value: 'again', label: 'Again' },
  { value: 'hard', label: 'Hard' },
  { value: 'good', label: 'Good' },
  { value: 'easy', label: 'Easy' },
];

interface GrammarReviewCandidate {
  pattern: GrammarPattern;
  sentence: Sentence;
  /**
   * Includes the correct pattern; length 1 means no other pattern exists
   * yet to contrast against (a fresh corpus with only one tracked
   * pattern) — GrammarCompletionCard degrades to a plain reveal in that
   * case rather than a broken one-option "choice."
   */
  choices: GrammarPattern[];
}

interface QueueCard {
  studyItem: StudyItem;
  sentence: Sentence;
  /** Set only for vocabulary-item-subject cards (e.g. reading_retrieval). */
  target?: { vocabularyItem: VocabularyItem; surfaceForm: string };
  /** Set only for audio-comprehension cards (listening). */
  audio?: SentenceAudio;
  /** Set only for word-in-context listening cards (per-occurrence word_listening). */
  wordListening?: WordListeningCandidate;
  /** Set only for contrastive-pair cards (Phase 7.7). */
  confusionPair?: ConfusionPairCandidate;
  /** Set only for contextual conjugation cards (per-occurrence sentence_transformation). */
  conjugation?: SentenceConjugationCandidate;
  /** Set only for pitch-accent cards. */
  pitchAccent?: PitchAccentReviewCandidate;
  /** Set only for grammar-pattern cards (grammar-learning system Phase 5). */
  grammar?: GrammarReviewCandidate;
  /** Set only for `reading_in_context` cards — the surrounding passage. */
  readingContext?: ReadingContext;
}

/** Splits `japanese` around the first occurrence of `surfaceForm`, for highlighting. */
function splitOnSurfaceForm(
  japanese: string,
  surfaceForm: string,
): [string, string, string] {
  const index = japanese.indexOf(surfaceForm);
  if (index === -1) return [japanese, '', ''];
  return [
    japanese.slice(0, index),
    surfaceForm,
    japanese.slice(index + surfaceForm.length),
  ];
}

// ---------------------------------------------------------------------------
// Activity descriptors (Phase 7.10, generalizing five previously
// hand-duplicated categories — flagged as due for this back in Phase 7.4's
// notes, docs/STATUS.md). Each descriptor packages one (subjectType,
// activityTypes, eligibility) category's already-fetched candidate list
// with the three functions that used to be copy-pasted per category: how
// to key a candidate (doubles as its due-lookup subjectId and pending-seed
// key), how to turn a (StudyItem, candidate) pair into a renderable
// QueueCard, and how to get-or-create that candidate's StudyItem. The
// due-queue/pending-seed logic in ReviewPage itself is now one generic
// loop over `descriptors` instead of five near-identical blocks.
// ---------------------------------------------------------------------------

interface ActivityDescriptor {
  key: string;
  activityTypes: StudyActivityType[];
  candidates: unknown[];
  existingItems: StudyItem[];
  subjectId: (candidate: unknown) => string;
  buildCard: (studyItem: StudyItem, candidate: unknown) => QueueCard;
  ensure: (candidate: unknown, activityType: StudyActivityType) => Promise<StudyItem>;
  /**
   * When set, the candidate's card is a "full sentence" card subject to
   * Phase 7.11 gating — withheld (from both seeding and the due queue) while
   * that sentence isn't ready for full review. Returns the sentence id to
   * check, or undefined to never gate this candidate.
   */
  gateSentenceId?: (candidate: unknown) => string | undefined;
  /**
   * A finer-grained gate than `gateSentenceId`'s sentence-readiness map:
   * returns false to withhold this candidate (from both seeding and the due
   * queue). Used for the two-tier listening ladder — tier-1 `word_listening`
   * waits on the word's own reading proficiency, tier-2 `listening` waits on
   * every tier-1 item. Evaluated in addition to `gateSentenceId`.
   */
  isReady?: (candidate: unknown, ctx: GateContext) => boolean;
}

/** Shared inputs for ActivityDescriptor.isReady, built once per queue build. */
interface GateContext {
  /** Vocabulary item ids (in scope) whose reading has reached FSRS proficiency. */
  proficientVocabularyItemIds: Set<string>;
  /** Sentence id -> every surface-form occurrence has a proficient `word_listening` item. */
  listeningReadiness: Map<string, boolean>;
}

/**
 * Each call site below is fully typed in its own candidate type `C`; the
 * cast here is the one place that fact isn't visible to the type checker
 * (an array mixing several `ActivityDescriptor<C>`s needs a common
 * non-generic shape) — centralized in this one helper rather than
 * scattered `any` throughout (this codebase otherwise has none).
 */
function defineActivityDescriptor<C>(descriptor: {
  key: string;
  activityTypes: StudyActivityType[];
  candidates: C[];
  existingItems: StudyItem[];
  subjectId: (candidate: C) => string;
  buildCard: (studyItem: StudyItem, candidate: C) => QueueCard;
  ensure: (candidate: C, activityType: StudyActivityType) => Promise<StudyItem>;
  gateSentenceId?: (candidate: C) => string | undefined;
  isReady?: (candidate: C, ctx: GateContext) => boolean;
}): ActivityDescriptor {
  return descriptor as unknown as ActivityDescriptor;
}

interface AudioCandidate {
  sentence: Sentence;
  audio: SentenceAudio;
}

interface ReviewScope {
  book: Book | undefined;
  sentences: Sentence[];
  existingSentenceItems: StudyItem[];
  /** Reading-order neighbours per in-scope sentence, for `reading_in_context`. */
  readingContextBySentenceId: Map<string, ReadingContext>;
  vocabularyTargetCandidates: VocabularyTargetCandidate[];
  existingVocabularyItems: StudyItem[];
  audioCandidates: AudioCandidate[];
  existingAudioItems: StudyItem[];
  confusionPairCandidates: ConfusionPairCandidate[];
  existingConfusionItems: StudyItem[];
  sentenceConjugationCandidates: SentenceConjugationCandidate[];
  existingConjugationItems: StudyItem[];
  wordListeningCandidates: WordListeningCandidate[];
  existingWordListeningItems: StudyItem[];
  pitchAccentCandidates: PitchAccentReviewCandidate[];
  existingPitchAccentItems: StudyItem[];
  grammarCandidates: GrammarReviewCandidate[];
  existingGrammarItems: StudyItem[];
  grammarContrastCandidates: GrammarReviewCandidate[];
  existingGrammarContrastItems: StudyItem[];
  grammarProductionCandidates: GrammarReviewCandidate[];
  existingGrammarProductionItems: StudyItem[];
}

function buildActivityDescriptors(scope: ReviewScope): ActivityDescriptor[] {
  return [
    defineActivityDescriptor<Sentence>({
      key: 'sentence',
      activityTypes: SENTENCE_ACTIVITY_TYPES,
      candidates: scope.sentences,
      existingItems: scope.existingSentenceItems,
      subjectId: (sentence) => sentence.id,
      buildCard: (studyItem, sentence) => ({
        studyItem,
        sentence,
        readingContext:
          studyItem.activityType === 'reading_in_context'
            ? scope.readingContextBySentenceId.get(sentence.id)
            : undefined,
      }),
      ensure: (sentence, activityType) => ensureStudyItem('sentence', sentence.id, activityType),
      gateSentenceId: (sentence) => sentence.id,
    }),
    defineActivityDescriptor<VocabularyTargetCandidate>({
      key: 'vocabulary',
      activityTypes: VOCABULARY_ACTIVITY_TYPES,
      candidates: scope.vocabularyTargetCandidates,
      existingItems: scope.existingVocabularyItems,
      subjectId: (candidate) => candidate.vocabularyItem.id,
      buildCard: (studyItem, candidate) => ({
        studyItem,
        sentence: candidate.sentence,
        target: { vocabularyItem: candidate.vocabularyItem, surfaceForm: candidate.surfaceForm },
      }),
      ensure: (candidate, activityType) =>
        ensureVocabularyStudyItem(candidate.vocabularyItem.id, activityType),
    }),
    defineActivityDescriptor<AudioCandidate>({
      key: 'listening',
      activityTypes: AUDIO_ACTIVITY_TYPES,
      candidates: scope.audioCandidates,
      existingItems: scope.existingAudioItems,
      subjectId: (candidate) => candidate.sentence.id,
      buildCard: (studyItem, candidate) => ({
        studyItem,
        sentence: candidate.sentence,
        audio: candidate.audio,
      }),
      ensure: (candidate, activityType) =>
        ensureStudyItem('sentence', candidate.sentence.id, activityType),
      // Tier 2 of the listening ladder: withheld until the sentence is ready
      // for full review (gateSentenceId) *and* every word_listening item for
      // its occurrences is proficient (isReady).
      gateSentenceId: (candidate) => candidate.sentence.id,
      isReady: (candidate, ctx) =>
        ctx.listeningReadiness.get(candidate.sentence.id) !== false,
    }),
    defineActivityDescriptor<WordListeningCandidate>({
      key: 'wordListening',
      activityTypes: WORD_LISTENING_ACTIVITY_TYPES,
      candidates: scope.wordListeningCandidates,
      existingItems: scope.existingWordListeningItems,
      subjectId: (candidate) => candidate.link.id,
      buildCard: (studyItem, candidate) => ({
        studyItem,
        sentence: candidate.sentence,
        wordListening: candidate,
      }),
      ensure: (candidate, activityType) =>
        ensureStudyItem('sentenceVocabulary', candidate.link.id, activityType),
      // Tier 1: withheld until the learner has demonstrated recall of the
      // word's reading (see WORD_LISTENING_ACTIVITY_TYPES).
      isReady: (candidate, ctx) =>
        ctx.proficientVocabularyItemIds.has(candidate.vocabularyItem.id),
    }),
    defineActivityDescriptor<ConfusionPairCandidate>({
      key: 'confusion',
      activityTypes: CONFUSION_ACTIVITY_TYPES,
      candidates: scope.confusionPairCandidates,
      existingItems: scope.existingConfusionItems,
      subjectId: (candidate) => candidate.confusion.id,
      buildCard: (studyItem, candidate) => ({
        studyItem,
        sentence: candidate.itemA.sentence,
        confusionPair: candidate,
      }),
      ensure: (candidate, activityType) =>
        ensureStudyItem('vocabularyConfusion', candidate.confusion.id, activityType),
    }),
    defineActivityDescriptor<SentenceConjugationCandidate>({
      key: 'conjugation',
      activityTypes: CONJUGATION_ACTIVITY_TYPES,
      candidates: scope.sentenceConjugationCandidates,
      existingItems: scope.existingConjugationItems,
      subjectId: (candidate) => candidate.link.id,
      buildCard: (studyItem, candidate) => ({
        studyItem,
        sentence: candidate.sentence,
        conjugation: candidate,
      }),
      ensure: (candidate, activityType) =>
        ensureStudyItem('sentenceVocabulary', candidate.link.id, activityType),
      gateSentenceId: (candidate) => candidate.sentence.id,
    }),
    defineActivityDescriptor<PitchAccentReviewCandidate>({
      key: 'pitchAccent',
      activityTypes: PITCH_ACCENT_ACTIVITY_TYPES,
      candidates: scope.pitchAccentCandidates,
      existingItems: scope.existingPitchAccentItems,
      subjectId: (candidate) => candidate.vocabularyItem.id,
      buildCard: (studyItem, candidate) => ({
        studyItem,
        sentence: candidate.sentence,
        pitchAccent: candidate,
      }),
      ensure: (candidate, activityType) =>
        ensureVocabularyStudyItem(candidate.vocabularyItem.id, activityType),
    }),
    defineActivityDescriptor<GrammarReviewCandidate>({
      key: 'grammar',
      activityTypes: GRAMMAR_ACTIVITY_TYPES,
      candidates: scope.grammarCandidates,
      existingItems: scope.existingGrammarItems,
      subjectId: (candidate) => candidate.pattern.id,
      buildCard: (studyItem, candidate) => ({
        studyItem,
        sentence: candidate.sentence,
        grammar: candidate,
      }),
      ensure: (candidate, activityType) =>
        ensureGrammarStudyItem(candidate.pattern.id, activityType),
    }),
    defineActivityDescriptor<GrammarReviewCandidate>({
      key: 'grammarContrast',
      activityTypes: GRAMMAR_CONTRAST_ACTIVITY_TYPES,
      candidates: scope.grammarContrastCandidates,
      existingItems: scope.existingGrammarContrastItems,
      subjectId: (candidate) => candidate.pattern.id,
      buildCard: (studyItem, candidate) => ({
        studyItem,
        sentence: candidate.sentence,
        grammar: candidate,
      }),
      ensure: (candidate, activityType) =>
        ensureGrammarStudyItem(candidate.pattern.id, activityType),
    }),
    defineActivityDescriptor<GrammarReviewCandidate>({
      key: 'grammarProduction',
      activityTypes: GRAMMAR_PRODUCTION_ACTIVITY_TYPES,
      candidates: scope.grammarProductionCandidates,
      existingItems: scope.existingGrammarProductionItems,
      subjectId: (candidate) => candidate.pattern.id,
      buildCard: (studyItem, candidate) => ({
        studyItem,
        sentence: candidate.sentence,
        grammar: candidate,
      }),
      ensure: (candidate, activityType) =>
        ensureGrammarStudyItem(candidate.pattern.id, activityType),
    }),
  ];
}

/** A (descriptor, candidate, activityType) triple with no study_item yet — needs seeding. `subjectId` doubles as the pending-seed batching key. */
interface PendingSeed {
  descriptorKey: string;
  candidate: unknown;
  activityType: StudyActivityType;
  subjectId: string;
}

export function ReviewPage() {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const activeSession = useActiveSession();
  // Only the `review` batch step type carries a targetCount to track against
  // (2026-08-26 follow-up). Prefer the step whose page this actually is
  // (`routeStep`) so the counter/auto-advance still work when the learner
  // opened reviews ahead of an earlier unfinished step; fall back to
  // `currentStep` for the ordinary "reviews are next" case.
  const reviewStep = [activeSession?.routeStep, activeSession?.currentStep].find(
    (step) => step?.targetKind === 'review',
  );
  const reviewsDoneThisStep = useLiveQuery(
    () => (reviewStep?.startedAt ? countReviewsSince(reviewStep.startedAt) : undefined),
    [reviewStep?.startedAt],
  );
  const [queue, setQueue] = useState<QueueCard[]>([]);
  const [pool, setPool] = useState<PendingSeed[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [assistanceUsed, setAssistanceUsed] = useState<Set<ReviewAssistance>>(
    () => new Set(),
  );
  /** Set only by reading_production's Check step; recorded as Review.responseRaw on rate. */
  const [typedResponse, setTypedResponse] = useState('');
  /**
   * The reading `reading_production`'s Check step actually graded the typed
   * answer against — the dictionary reading, or the in-context inflected
   * reading when that's what the learner matched. Recorded as
   * `Review.expectedAnswer` so `classifyReviewError` reaches the same ✓/✗
   * verdict the card showed (otherwise an accepted inflected reading would
   * still be logged as `incorrect_reading`).
   */
  const [typedResponseExpected, setTypedResponseExpected] = useState<string | null>(null);
  /** "Report issue" — an inline text box, not window.prompt (silently no-ops on installed iOS Safari PWAs). */
  const [reportingIssue, setReportingIssue] = useState(false);
  const [issueNote, setIssueNote] = useState('');
  const [submittingIssue, setSubmittingIssue] = useState(false);
  const [issueReported, setIssueReported] = useState(false);
  /**
   * Session planner (Phase 7.10): counts distinct new subjects seeded this
   * sitting (one per batch, not per card — a word's reading_retrieval +
   * cloze + reading_production seeding together still counts once), so it
   * can be compared against `settings.newCardsPerSessionLimit`. Resets on
   * remount (a fresh page load is a fresh session), not persisted.
   */
  const [newCardsIntroduced, setNewCardsIntroduced] = useState(0);
  /** Listening-card playback speed (Phase 7.4 follow-up) — session-only, like ShadowPage's, not persisted. */
  const [audioSpeed, setAudioSpeed] = useState(1);

  const settings = useLiveQuery(() => readSettings(), []);

  const scope = useLiveQuery(async (): Promise<ReviewScope> => {
    const db = getDb();
    const book = bookId ? await db.books.get(bookId) : undefined;
    let sentences: Sentence[];
    if (bookId) {
      const memberships = await db.bookSentences
        .where('bookId')
        .equals(bookId)
        .sortBy('position');
      const found = await db.sentences.bulkGet(
        memberships.map((item) => item.sentenceId),
      );
      sentences = found.filter((item): item is Sentence => Boolean(item));
    } else {
      sentences = await db.sentences.toArray();
      sentences.sort(
        (a, b) => a.firstOccurrenceIndex - b.firstOccurrenceIndex,
      );
    }
    const sentenceIds = sentences.map((item) => item.id);
    const sentenceIdSet = new Set(sentenceIds);
    const bySentenceId = new Map(sentences.map((item) => [item.id, item]));
    const existingSentenceItems = (
      await db.studyItems
        .where('activityType')
        .anyOf(SENTENCE_ACTIVITY_TYPES)
        .toArray()
    ).filter(
      (item) => item.subjectType === 'sentence' && sentenceIdSet.has(item.subjectId),
    );

    const vocabularyTargetCandidates = await getVocabularyTargetCandidates(sentenceIds);
    const vocabularyItemIdSet = new Set(
      vocabularyTargetCandidates.map((candidate) => candidate.vocabularyItem.id),
    );
    const existingVocabularyItems = (
      await db.studyItems
        .where('activityType')
        .anyOf(VOCABULARY_ACTIVITY_TYPES)
        .toArray()
    ).filter(
      (item) =>
        item.subjectType === 'vocabularyItem' &&
        vocabularyItemIdSet.has(item.subjectId),
    );

    // Audio comprehension is only eligible for sentences that have at
    // least one reference recording — first one found per sentence wins
    // (no book-specific source preference, unlike PracticePage's audio
    // picker; scoped down deliberately, see docs/STATUS.md).
    const audioRows = await db.sentenceAudio
      .where('sentenceId')
      .anyOf(sentenceIds)
      .toArray();
    const audioBySentenceId = new Map<string, SentenceAudio>();
    for (const row of audioRows) {
      if (!audioBySentenceId.has(row.sentenceId)) {
        audioBySentenceId.set(row.sentenceId, row);
      }
    }
    const audioCandidates: AudioCandidate[] = [];
    for (const [sentenceId, audio] of audioBySentenceId) {
      const sentence = bySentenceId.get(sentenceId);
      if (sentence) audioCandidates.push({ sentence, audio });
    }
    const existingAudioItems = (
      await db.studyItems
        .where('activityType')
        .anyOf(AUDIO_ACTIVITY_TYPES)
        .toArray()
    ).filter(
      (item) => item.subjectType === 'sentence' && audioBySentenceId.has(item.subjectId),
    );

    const confusionPairCandidates = await getConfusionPairCandidates(
      vocabularyTargetCandidates,
    );
    const confusionPairIdSet = new Set(
      confusionPairCandidates.map((candidate) => candidate.confusion.id),
    );
    const existingConfusionItems = (
      await db.studyItems
        .where('activityType')
        .anyOf(CONFUSION_ACTIVITY_TYPES)
        .toArray()
    ).filter(
      (item) =>
        item.subjectType === 'vocabularyConfusion' &&
        confusionPairIdSet.has(item.subjectId),
    );

    const occurrenceCandidates = await getVocabularyOccurrenceCandidates(sentenceIds);

    const sentenceConjugationCandidates =
      getSentenceConjugationCandidates(occurrenceCandidates);
    const conjugationLinkIdSet = new Set(
      sentenceConjugationCandidates.map((candidate) => candidate.link.id),
    );
    const existingConjugationItems = (
      await db.studyItems
        .where('activityType')
        .anyOf(CONJUGATION_ACTIVITY_TYPES)
        .toArray()
    ).filter(
      (item) =>
        item.subjectType === 'sentenceVocabulary' &&
        conjugationLinkIdSet.has(item.subjectId),
    );

    const wordListeningCandidates = getWordListeningCandidates(
      occurrenceCandidates,
      audioBySentenceId,
    );
    const wordListeningLinkIdSet = new Set(
      wordListeningCandidates.map((candidate) => candidate.link.id),
    );
    const existingWordListeningItems = (
      await db.studyItems
        .where('activityType')
        .anyOf(WORD_LISTENING_ACTIVITY_TYPES)
        .toArray()
    ).filter(
      (item) =>
        item.subjectType === 'sentenceVocabulary' &&
        wordListeningLinkIdSet.has(item.subjectId),
    );

    const pitchAccentCandidates = getPitchAccentReviewCandidates(
      vocabularyTargetCandidates,
      audioBySentenceId,
    );
    const pitchAccentVocabularyItemIdSet = new Set(
      pitchAccentCandidates.map((candidate) => candidate.vocabularyItem.id),
    );
    const existingPitchAccentItems = (
      await db.studyItems
        .where('activityType')
        .anyOf(PITCH_ACCENT_ACTIVITY_TYPES)
        .toArray()
    ).filter(
      (item) =>
        item.subjectType === 'vocabularyItem' &&
        pitchAccentVocabularyItemIdSet.has(item.subjectId),
    );

    // Grammar patterns (grammar-learning system Phase 5): global scope
    // only (bookId unset) — a tracked pattern isn't scoped to one book the
    // way a sentence is, and its "context sentence" may come from any book
    // it's been encountered in. Candidates are built from already-tracked
    // patterns (any existing grammarPattern study item), not "every
    // pattern in the corpus" — see GRAMMAR_ACTIVITY_TYPES's doc comment.
    let grammarCandidates: GrammarReviewCandidate[] = [];
    let existingGrammarItems: StudyItem[] = [];
    let grammarContrastCandidates: GrammarReviewCandidate[] = [];
    let existingGrammarContrastItems: StudyItem[] = [];
    let grammarProductionCandidates: GrammarReviewCandidate[] = [];
    let existingGrammarProductionItems: StudyItem[] = [];
    if (!bookId) {
      const allGrammarPatternStudyItems = (
        await db.studyItems
          .where('activityType')
          .anyOf([
            ...GRAMMAR_ACTIVITY_TYPES,
            ...GRAMMAR_CONTRAST_ACTIVITY_TYPES,
            ...GRAMMAR_PRODUCTION_ACTIVITY_TYPES,
          ])
          .toArray()
      ).filter((item) => item.subjectType === 'grammarPattern');
      const grammarStudyItems = allGrammarPatternStudyItems.filter((item) =>
        GRAMMAR_ACTIVITY_TYPES.includes(item.activityType),
      );
      const grammarContrastStudyItems = allGrammarPatternStudyItems.filter(
        (item) => item.activityType === 'grammar_contrast',
      );
      const grammarProductionStudyItems = allGrammarPatternStudyItems.filter(
        (item) => item.activityType === 'grammar_production',
      );
      // grammar_production comes after recognition: a pattern is only a
      // candidate once its grammar_comprehension item is FSRS-proficient
      // (learner state `recognized`+), same bar computeGrammarLearnerState uses.
      const recognizedPatternIds = new Set(
        grammarStudyItems
          .filter(
            (item) =>
              item.activityType === 'grammar_comprehension' &&
              isVocabularyItemProficient(item.fsrsState.state),
          )
          .map((item) => item.subjectId),
      );
      const trackedPatternIds = [...new Set(grammarStudyItems.map((item) => item.subjectId))];
      if (trackedPatternIds.length > 0) {
        const [trackedPatterns, allPatterns, relationships] = await Promise.all([
          db.grammarPatterns.bulkGet(trackedPatternIds),
          db.grammarPatterns.toArray(),
          db.grammarRelationships.toArray(),
        ]);
        const patternsById = new Map(allPatterns.map((item) => [item.id, item]));
        // Rank GrammarRelationship-linked patterns first among completion
        // distractors (grammar-learning system Phase 8) — a distractor the
        // learner has actually flagged as confusable is more useful than a
        // random one from the corpus. See buildGrammarCompletionChoices's
        // doc comment. The same map also drives grammar_contrast candidates
        // below (Phase 9 slice) — a contrast card only exists for a pattern
        // with at least one relationship, quizzing specifically the linked
        // pair rather than a pool of arbitrary corpus distractors.
        const relatedPatternIdsByPattern = new Map<string, Set<string>>();
        for (const relationship of relationships) {
          const addRelation = (id: string, otherId: string) => {
            const set = relatedPatternIdsByPattern.get(id);
            if (set) set.add(otherId);
            else relatedPatternIdsByPattern.set(id, new Set([otherId]));
          };
          addRelation(relationship.patternAId, relationship.patternBId);
          addRelation(relationship.patternBId, relationship.patternAId);
        }
        for (const pattern of trackedPatterns) {
          if (!pattern) continue;
          const context = await pickContextSentenceForGrammarPattern(pattern.id);
          if (!context) continue;
          const otherPatterns = allPatterns.filter((item) => item.id !== pattern.id);
          const relatedPatternIds = relatedPatternIdsByPattern.get(pattern.id);
          grammarCandidates.push({
            pattern,
            sentence: context.sentence,
            choices: buildGrammarCompletionChoices(
              pattern,
              otherPatterns,
              undefined,
              relatedPatternIds,
            ),
          });
          if (relatedPatternIds && relatedPatternIds.size > 0) {
            const relatedPatterns = [...relatedPatternIds]
              .map((id) => patternsById.get(id))
              .filter((item): item is GrammarPattern => !!item);
            grammarContrastCandidates.push({
              pattern,
              sentence: context.sentence,
              choices: buildGrammarCompletionChoices(pattern, relatedPatterns, 2),
            });
          }
          if (recognizedPatternIds.has(pattern.id)) {
            grammarProductionCandidates.push({
              pattern,
              sentence: context.sentence,
              choices: [],
            });
          }
        }
        const grammarCandidateIds = new Set(grammarCandidates.map((c) => c.pattern.id));
        existingGrammarItems = grammarStudyItems.filter((item) =>
          grammarCandidateIds.has(item.subjectId),
        );
        const grammarContrastCandidateIds = new Set(
          grammarContrastCandidates.map((c) => c.pattern.id),
        );
        existingGrammarContrastItems = grammarContrastStudyItems.filter((item) =>
          grammarContrastCandidateIds.has(item.subjectId),
        );
        const grammarProductionCandidateIds = new Set(
          grammarProductionCandidates.map((c) => c.pattern.id),
        );
        existingGrammarProductionItems = grammarProductionStudyItems.filter((item) =>
          grammarProductionCandidateIds.has(item.subjectId),
        );
      }
    }

    // Reading-order neighbours for `reading_in_context` cards
    // (docs/ROADMAP.md). Book scope: the queue only holds one book's
    // sentences, so context stays within that book. Global scope: load
    // every membership + book so each sentence's home book (most recently
    // opened) can be resolved.
    const contextBookSentences = bookId
      ? await db.bookSentences.where('bookId').equals(bookId).toArray()
      : await db.bookSentences.toArray();
    const contextBooks = bookId ? (book ? [book] : []) : await db.books.toArray();
    const readingContextBySentenceId = buildReadingContextMap({
      targetSentenceIds: sentenceIds,
      bookSentences: contextBookSentences,
      books: contextBooks,
      sentencesById: bySentenceId,
    });

    return {
      book,
      sentences,
      existingSentenceItems,
      readingContextBySentenceId,
      vocabularyTargetCandidates,
      existingVocabularyItems,
      audioCandidates,
      existingAudioItems,
      confusionPairCandidates,
      existingConfusionItems,
      sentenceConjugationCandidates,
      existingConjugationItems,
      wordListeningCandidates,
      existingWordListeningItems,
      pitchAccentCandidates,
      existingPitchAccentItems,
      grammarCandidates,
      existingGrammarItems,
      grammarContrastCandidates,
      existingGrammarContrastItems,
      grammarProductionCandidates,
      existingGrammarProductionItems,
    };
  }, [bookId]);

  const descriptors = useMemo(
    () => (scope ? buildActivityDescriptors(scope) : []),
    [scope],
  );

  // Build the session queue once, the first time scope data arrives —
  // re-running this on every live-query tick would reshuffle the queue out
  // from under the user mid-session as recordReview() updates studyItems.
  // Due-ness is delegated to getDueStudyItems so this stays the single
  // source of truth for "due" semantics (not reimplemented here too).
  useEffect(() => {
    if (!scope || initialized || !settings) return;
    let cancelled = false;
    void (async () => {
      // Full-sentence review gating (user request, 2026-08-16): before
      // computing what's due, push out any sentence card whose vocabulary
      // hasn't been shown proficient yet — see deferUnreadySentenceReviews.
      // That only covers items that already exist; a sentence with no
      // study_item yet for some SENTENCE_ACTIVITY_TYPES entry (e.g. only
      // comprehension has ever been seeded, not reading_in_context) would
      // otherwise bypass it entirely via lazy seeding below — sentenceReadiness
      // covers that path.
      await deferUnreadySentenceReviews(SENTENCE_ACTIVITY_TYPES);
      // Same gate for tracked grammar patterns: a grammarPattern-subject card
      // (comprehension/completion/contrast/production) whose pattern has no
      // full-review-ready linked sentence is dropped from the queue below
      // anyway (pickContextSentenceForGrammarPattern → undefined) — push its
      // stored due date out too so it stops counting as due backlog.
      await deferUnreadyGrammarReviews();
      const sentenceIds = scope.sentences.map((sentence) => sentence.id);
      const sentenceReadiness = await getSentenceFullReviewReadiness(sentenceIds);

      // Listening-ladder gates (ActivityDescriptor.isReady). Tier 1
      // (word_listening) waits on the word's reading proficiency; tier 2
      // (listening) waits on every tier-1 item. Like the conjugation card,
      // these have no defer pass of their own — the isGatedOut filter below
      // keeps them out of the queue and the pending-seed pool.
      const gateContext: GateContext = {
        proficientVocabularyItemIds: await getProficientVocabularyItemIds([
          ...new Set(
            scope.wordListeningCandidates.map((candidate) => candidate.vocabularyItem.id),
          ),
        ]),
        listeningReadiness: await getSentenceListeningReadiness(sentenceIds),
      };

      const dueByDescriptor = await Promise.all(
        descriptors.map((descriptor) =>
          getDueStudyItems(descriptor.activityTypes, {
            subjectIds: descriptor.candidates.map(descriptor.subjectId),
            graduationMinScheduledDays: settings.graduationMinScheduledDays,
          }),
        ),
      );

      // Phase 7.11 gating: a "full sentence" card (see descriptor.gateSentenceId
      // — the sentence-subject cards, and the contextual conjugation card,
      // which is per-sentence-occurrence) is withheld while its sentence isn't
      // ready for full review. deferUnreadySentenceReviews above pushes out
      // existing sentence-subject due items; this check also covers the
      // conjugation card (no defer pass of its own) and is belt-and-braces for
      // sentence cards.
      const isGatedOut = (descriptor: ActivityDescriptor, candidate: unknown): boolean => {
        const gateSentenceId = descriptor.gateSentenceId?.(candidate);
        if (!!gateSentenceId && sentenceReadiness.get(gateSentenceId) === false) return true;
        if (descriptor.isReady && !descriptor.isReady(candidate, gateContext)) return true;
        return false;
      };

      const due: QueueCard[] = [];
      descriptors.forEach((descriptor, index) => {
        const byId = new Map(
          descriptor.candidates.map((candidate) => [descriptor.subjectId(candidate), candidate]),
        );
        for (const studyItem of dueByDescriptor[index]!) {
          const candidate = byId.get(studyItem.subjectId);
          if (candidate && !isGatedOut(descriptor, candidate)) {
            due.push(descriptor.buildCard(studyItem, candidate));
          }
        }
      });
      due.sort((a, b) => a.studyItem.fsrsState.due.localeCompare(b.studyItem.fsrsState.due));

      // Bury siblings for the session (Anki's default behaviour). 世話's
      // cloze / reading_retrieval / reading_production are three study items
      // on one subject; graded alike each session they converge on
      // near-identical FSRS due timestamps, so the sort above lands them
      // adjacently and the first card's reveal turns the rest into a
      // short-term echo test — a hollow "Good" that inflates their intervals.
      // Once a subject has a card in the queue, hold its other *due* cards
      // for the next session; they stay due, they just don't compete for a
      // slot today. Only `review`/`relearning` items are buried: `new` and
      // `learning` are early acquisition where the multi-card run is intended
      // first-exposure scaffolding (and the lazy-seed path below deliberately
      // seeds a whole batch at once). Keyed by subjectType+subjectId so a
      // word's reading cards and its pitch-accent card count as siblings too.
      const shownSubjects = new Set<string>();
      const deduped = due.filter((card) => {
        const key = `${card.studyItem.subjectType}:${card.studyItem.subjectId}`;
        const settled =
          card.studyItem.fsrsState.state === 'review' ||
          card.studyItem.fsrsState.state === 'relearning';
        if (settled && shownSubjects.has(key)) return false;
        shownSubjects.add(key);
        return true;
      });

      // Any (subject, activityType) pair with no study_item yet needs
      // seeding — tracked per-pair (not per-subject) so a subject left with
      // only some activity types seeded still gets the rest. Built per
      // descriptor first, then interleaved round-robin across descriptors
      // (Phase 7.10, docs/STATUS.md) rather than concatenated — a
      // real-data check found a book with 206 sentences and ~50 eligible
      // vocabulary items would've required clicking through ~400 sentence
      // cards before a single vocabulary-based card ever seeded, since the
      // seeding effect below always takes pool[0]. Interleaving means a
      // mix of card types shows up from early in the session instead,
      // matching the "one unified session, not six mandatory cards"
      // principle Phase 7.2 already established for the due-queue merge —
      // this is the same principle applied to lazy seeding. Batching by
      // (descriptorKey, subjectId) below is a filter over the whole pool,
      // not a positional slice, so a candidate's several activity types
      // (e.g. a word's reading_retrieval/cloze/reading_production) still
      // seed together as one batch even when scattered non-adjacently.
      const pendingSeedsByDescriptor: PendingSeed[][] = descriptors.map((descriptor) => {
        const existingKeys = new Set(
          descriptor.existingItems.map(
            (item) => `${item.subjectId}:${item.activityType}`,
          ),
        );
        const seeds: PendingSeed[] = [];
        for (const candidate of descriptor.candidates) {
          const subjectId = descriptor.subjectId(candidate);
          // A not-yet-ready sentence (Phase 7.11) never gets a *new*
          // full-sentence study item lazily seeded (existing ones are
          // handled above) — same rule for the per-occurrence conjugation
          // card, see descriptor.gateSentenceId.
          if (isGatedOut(descriptor, candidate)) {
            continue;
          }
          for (const activityType of descriptor.activityTypes) {
            if (!existingKeys.has(`${subjectId}:${activityType}`)) {
              seeds.push({ descriptorKey: descriptor.key, candidate, activityType, subjectId });
            }
          }
        }
        return seeds;
      });
      const pendingSeeds: PendingSeed[] = [];
      const maxPendingSeeds = Math.max(0, ...pendingSeedsByDescriptor.map((seeds) => seeds.length));
      for (let index = 0; index < maxPendingSeeds; index += 1) {
        for (const seeds of pendingSeedsByDescriptor) {
          if (seeds[index]) pendingSeeds.push(seeds[index]!);
        }
      }

      if (cancelled) return;
      setQueue(deduped);
      setPool(pendingSeeds);
      setInitialized(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, initialized, descriptors, settings]);

  // Lazily seed study_items for the next never-reviewed subject once the
  // due queue runs dry (confirmed with the user — no batch seeding step),
  // gated by the session planner's new-card cap (Phase 7.10,
  // settings.newCardsPerSessionLimit) — already-due reviews above are
  // never subject to this, only the introduction of brand-new subjects.
  useEffect(() => {
    if (!initialized || queue.length > 0 || pool.length === 0 || seeding) return;
    if (!settings) return;
    if (newCardsIntroduced >= settings.newCardsPerSessionLimit) return;
    const first = pool[0]!;
    const batch = pool.filter(
      (item) => item.descriptorKey === first.descriptorKey && item.subjectId === first.subjectId,
    );
    const descriptor = descriptors.find((candidate) => candidate.key === first.descriptorKey);
    if (!descriptor) return;
    setSeeding(true);
    void (async () => {
      const cards = await Promise.all(
        batch.map(async (item) => {
          const studyItem = await descriptor.ensure(item.candidate, item.activityType);
          return descriptor.buildCard(studyItem, item.candidate);
        }),
      );
      setPool((current) =>
        current.filter(
          (item) =>
            !(item.descriptorKey === first.descriptorKey && item.subjectId === first.subjectId),
        ),
      );
      setQueue(cards);
      setNewCardsIntroduced((count) => count + 1);
      setSeeding(false);
    })();
  }, [initialized, queue.length, pool, seeding, descriptors, settings, newCardsIntroduced]);

  const current = queue[0];

  useEffect(() => {
    setRevealed(false);
    setAssistanceUsed(new Set());
    setTypedResponse('');
    setTypedResponseExpected(null);
    setReportingIssue(false);
    setIssueNote('');
    setIssueReported(false);
  }, [current?.studyItem.id]);

  function markAssistance(kind: ReviewAssistance) {
    setAssistanceUsed((current) => (current.has(kind) ? current : new Set(current).add(kind)));
  }

  async function handleRate(rating: ReviewRating) {
    if (!current || submitting) return;
    setSubmitting(true);
    try {
      const expectedAnswerValue =
        typedResponseExpected ??
        (current.conjugation
          ? current.conjugation.expectedReadings[0]
          : current.grammar
            ? current.grammar.pattern.canonicalName
            : current.target?.vocabularyItem.reading);
      // grammar_production's typed response is a free-form sentence the
      // learner self-grades — there's no single expected string to compare,
      // so record it as responseRaw only (no expectedAnswer → classifyReviewError
      // leaves it unclassified, same as comprehension).
      const isFreeformResponse = current.studyItem.activityType === 'grammar_production';
      await recordReview({
        studyItemId: current.studyItem.id,
        rating,
        assistance: assistanceUsed.size > 0 ? [...assistanceUsed] : undefined,
        responseRaw: typedResponse || undefined,
        expectedAnswer: typedResponse && !isFreeformResponse ? expectedAnswerValue : undefined,
      });
      setQueue((q) => q.slice(1));

      // Session-aware auto-advance (2026-08-26 follow-up): once this
      // review completes the active session's `review` step's target
      // count, settle the step and jump straight to the next one, instead
      // of leaving the learner to notice and go back to Mark it complete.
      // But hold the step open while never-introduced words are still
      // waiting to be seeded this sitting (docs/STATUS.md "Review new-card
      // backlog") — the planner reserves review minutes for them, and
      // `targetCount` undercounts them (one increment per word, ~3 cards
      // seeded), so without this guard the step would settle before
      // ReviewPage ever drains the pending-seed pool.
      const moreNewCardsThisSession =
        pool.length > 0 &&
        !!settings &&
        newCardsIntroduced < settings.newCardsPerSessionLimit;
      if (activeSession && reviewStep?.targetCount) {
        const doneCount = (reviewsDoneThisStep ?? 0) + 1;
        if (doneCount >= reviewStep.targetCount && !moreNewCardsThisSession) {
          const result = await settleSessionStep(activeSession.session.id, reviewStep.id, 'completed');
          const nextPath = result?.nextStep ? sessionStepTargetPath(result.nextStep) : null;
          if (nextPath) navigate(nextPath);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReportIssue() {
    if (!current || !issueNote.trim() || submittingIssue) return;
    setSubmittingIssue(true);
    try {
      await reportCardIssue({
        studyItemId: current.studyItem.id,
        sentenceId: current.sentence.id,
        activityType: current.studyItem.activityType,
        note: issueNote.trim(),
      });
      setReportingIssue(false);
      setIssueNote('');
      setIssueReported(true);
    } finally {
      setSubmittingIssue(false);
    }
  }

  if (bookId && scope === undefined) return <p className="muted">Loading…</p>;
  if (!initialized) return <p className="muted">Loading…</p>;

  const totalScopedSubjects = descriptors.reduce(
    (sum, descriptor) => sum + descriptor.candidates.length,
    0,
  );
  const nextDue = descriptors
    .flatMap((descriptor) => descriptor.existingItems)
    .filter((item) => item.fsrsState.due > new Date().toISOString())
    .sort((a, b) => a.fsrsState.due.localeCompare(b.fsrsState.due))[0]?.fsrsState.due;
  // New-card cap reached (Phase 7.10) with genuinely new subjects still
  // waiting — distinct from "nothing left to seed at all."
  const remainingNewSubjects = new Set(
    pool.map((item) => `${item.descriptorKey}:${item.subjectId}`),
  ).size;
  const newCardLimitReached =
    !!settings &&
    newCardsIntroduced >= settings.newCardsPerSessionLimit &&
    remainingNewSubjects > 0;

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="muted">
              {scope?.book ? `${scope.book.title} · Review` : 'Review'}
            </div>
          </div>
          {bookId ? (
            <Link to={`/books/${bookId}`}>
              <button type="button">Back to book</button>
            </Link>
          ) : null}
        </div>

        {reviewStep?.targetCount ? (
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            Reviews this step: {Math.min(reviewsDoneThisStep ?? 0, reviewStep.targetCount)} /{' '}
            {reviewStep.targetCount}
          </div>
        ) : null}

        {scope && totalScopedSubjects === 0 ? (
          <p className="muted">No sentences to review here yet.</p>
        ) : seeding ? (
          <p className="muted">Loading next card…</p>
        ) : !current ? (
          <div className="empty-state">
            <strong>All caught up.</strong>
            {newCardLimitReached ? (
              <span className="muted">
                New-card limit reached for this session ({newCardsIntroduced} of{' '}
                {settings!.newCardsPerSessionLimit} introduced) — {remainingNewSubjects} more
                waiting next time. Raise the limit in Settings if you want more now.
              </span>
            ) : (
              <span className="muted">
                {nextDue
                  ? `Next review due ${new Date(nextDue).toLocaleString()}.`
                  : 'Nothing due right now.'}
              </span>
            )}
          </div>
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="muted">
                {ACTIVITY_LABELS[current.studyItem.activityType] ??
                  current.studyItem.activityType}{' '}
                · {queue.length} due
              </div>
              <Link to={`/study-items/${current.studyItem.id}`}>Why?</Link>
            </div>
            {reportingIssue ? (
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleReportIssue();
                }}
              >
                <textarea
                  value={issueNote}
                  onChange={(event) => setIssueNote(event.target.value)}
                  placeholder="What's wrong with this card?"
                  rows={3}
                  autoFocus
                />
                <div className="row">
                  <button type="submit" disabled={!issueNote.trim() || submittingIssue}>
                    Submit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReportingIssue(false);
                      setIssueNote('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <button type="button" onClick={() => setReportingIssue(true)}>
                  Report issue
                </button>
                {issueReported ? <span className="muted">✓ Reported</span> : null}
              </div>
            )}
            {current.target && current.studyItem.activityType === 'reading_production' ? (
              <ReadingProductionCard
                key={current.studyItem.id}
                sentence={current.sentence}
                vocabularyItem={current.target.vocabularyItem}
                surfaceForm={current.target.surfaceForm}
                revealed={revealed}
                onCheck={(value, gradedAgainst) => {
                  setTypedResponse(value);
                  setTypedResponseExpected(gradedAgainst);
                  setRevealed(true);
                }}
              />
            ) : current.target ? (
              <VocabularyTargetCard
                activityType={current.studyItem.activityType}
                sentence={current.sentence}
                vocabularyItem={current.target.vocabularyItem}
                surfaceForm={current.target.surfaceForm}
                revealed={revealed}
                onReveal={() => setRevealed(true)}
              />
            ) : current.audio ? (
              <AudioComprehensionCard
                key={current.studyItem.id}
                sentence={current.sentence}
                audio={current.audio}
                revealed={revealed}
                onReveal={() => setRevealed(true)}
                onReplay={() => markAssistance('audio_replayed')}
                playbackRate={audioSpeed}
                onPlaybackRateChange={setAudioSpeed}
              />
            ) : current.wordListening ? (
              <WordListeningCard
                key={current.studyItem.id}
                candidate={current.wordListening}
                revealed={revealed}
                onReveal={() => setRevealed(true)}
                onReplay={() => markAssistance('audio_replayed')}
                playbackRate={audioSpeed}
                onPlaybackRateChange={setAudioSpeed}
              />
            ) : current.confusionPair ? (
              <ContrastivePairCard
                candidate={current.confusionPair}
                revealed={revealed}
                onReveal={() => setRevealed(true)}
              />
            ) : current.conjugation ? (
              <SentenceConjugationCard
                key={current.studyItem.id}
                candidate={current.conjugation}
                revealed={revealed}
                onCheck={(value, gradedAgainst) => {
                  setTypedResponse(value);
                  setTypedResponseExpected(gradedAgainst);
                  setRevealed(true);
                }}
              />
            ) : current.pitchAccent ? (
              <PitchAccentCard
                key={current.studyItem.id}
                candidate={current.pitchAccent}
                revealed={revealed}
                onCheck={(value, gradedAgainst) => {
                  setTypedResponse(value);
                  setTypedResponseExpected(gradedAgainst);
                  setRevealed(true);
                }}
              />
            ) : current.grammar && current.studyItem.activityType === 'grammar_contrast' ? (
              <GrammarContrastCard
                key={current.studyItem.id}
                candidate={current.grammar}
                revealed={revealed}
                onCheck={(value) => {
                  setTypedResponse(value);
                  setRevealed(true);
                }}
              />
            ) : current.grammar && current.studyItem.activityType === 'grammar_completion' ? (
              <GrammarCompletionCard
                key={current.studyItem.id}
                candidate={current.grammar}
                revealed={revealed}
                onCheck={(value) => {
                  setTypedResponse(value);
                  setRevealed(true);
                }}
              />
            ) : current.grammar && current.studyItem.activityType === 'grammar_production' ? (
              <GrammarProductionCard
                key={current.studyItem.id}
                candidate={current.grammar}
                revealed={revealed}
                onReveal={(value) => {
                  setTypedResponse(value);
                  setRevealed(true);
                }}
              />
            ) : current.grammar ? (
              <GrammarComprehensionCard
                candidate={current.grammar}
                revealed={revealed}
                onReveal={() => setRevealed(true)}
              />
            ) : current.studyItem.activityType === 'reading_in_context' ? (
              <ReadingInContextCard
                sentence={current.sentence}
                context={current.readingContext}
                revealed={revealed}
                onReveal={() => setRevealed(true)}
              />
            ) : (
              <>
                <div className="jp jp-lg">{current.sentence.japanese}</div>
                {!revealed ? (
                  <button type="button" onClick={() => setRevealed(true)}>
                    Reveal
                  </button>
                ) : (
                  <>
                    <div>{current.sentence.translation || '(no translation)'}</div>
                    <VocabChips items={current.sentence.targetVocabulary} />
                  </>
                )}
              </>
            )}
            {revealed &&
            current.studyItem.activityType !== 'pitch_accent' &&
            current.studyItem.activityType !== 'sentence_transformation' ? (
              // Ambient pitch-accent contour for the sentence under review.
              // `pitch_accent` renders its own (target-highlighted) copy;
              // `sentence_transformation` is skipped because its verb is
              // inflected and this row draws the citation-form contour.
              <SentencePitchAccentRow
                japanese={current.sentence.japanese}
                sentenceId={current.sentence.id}
              />
            ) : null}
            {revealed && (current.audio ?? current.wordListening?.audio) ? (
              // Measured pitch of the native clip — only on the audio-centric
              // cards (listening / word_listening), under the H/L row.
              <ReviewPitchContour audio={(current.audio ?? current.wordListening?.audio)!} />
            ) : null}
            {revealed ? (
              <div className="row">
                {RATINGS.map((rating) => (
                  <button
                    key={rating.value}
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleRate(rating.value)}
                  >
                    {rating.label}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

/**
 * `reading_in_context` card body — the same reveal flow as plain
 * `comprehension` (see JP, reveal EN + vocab, self-rate), but the sentence
 * under test is framed by its reading-order neighbours (buildReadingContextMap):
 * the preceding sentences are shown untranslated above it so the passage
 * sets the scene without spoiling the answer, and the following sentence's
 * translation joins the reveal. With no context available (inbox-only
 * sentence, or a book-scoped queue whose neighbours aren't loaded) it
 * degrades to the isolated layout.
 */
function ReadingInContextCard({
  sentence,
  context,
  revealed,
  onReveal,
}: {
  sentence: Sentence;
  context: ReadingContext | undefined;
  revealed: boolean;
  onReveal: () => void;
}) {
  const before = context?.before ?? [];
  const after = context?.after ?? [];
  return (
    <>
      {context?.bookTitle ? (
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          In context · {context.bookTitle}
        </p>
      ) : null}
      {before.length ? (
        <div className="reading-context">
          {before.map((item) => (
            <p key={item.id} className="jp jp-sm reading-context-line">
              {item.japanese}
            </p>
          ))}
        </div>
      ) : null}
      <div className="jp jp-lg">{sentence.japanese}</div>
      {!revealed ? (
        <button type="button" onClick={onReveal}>
          Reveal
        </button>
      ) : (
        <>
          <div>{sentence.translation || '(no translation)'}</div>
          <VocabChips items={sentence.targetVocabulary} />
          {after.length ? (
            <div className="reading-context">
              {after.map((item) => (
                <p key={item.id} className="reading-context-line">
                  <span className="jp jp-sm">{item.japanese}</span>
                  {item.translation ? (
                    <span className="muted"> — {item.translation}</span>
                  ) : null}
                </p>
              ))}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

/**
 * Renders both vocabulary-item-subject card types (Phase 7.2/7.3): they
 * share the highlighted-sentence layout and only differ in what's hidden
 * before reveal. `reading_retrieval` shows the target word, hides its
 * reading. `cloze` hides the target word itself (a blank), and reveals it
 * alongside the reading — a step harder, since there's no visible word to
 * anchor recall against.
 *
 * `cloze` also shows the sentence translation as a pre-reveal hint: a bare
 * grammatical blank often admits many plausible fillers (e.g. "the ___ I
 * saw" fits movie/book/photo/... equally), so without the meaning the
 * exercise degenerates into remembering which exact word this sentence
 * used rather than recalling the word from its meaning-in-context.
 */
function VocabularyTargetCard({
  activityType,
  sentence,
  vocabularyItem,
  surfaceForm,
  revealed,
  onReveal,
}: {
  activityType: StudyActivityType;
  sentence: Sentence;
  vocabularyItem: VocabularyItem;
  surfaceForm: string;
  revealed: boolean;
  onReveal: () => void;
}) {
  const isCloze = activityType === 'cloze';
  const [before, target, after] = splitOnSurfaceForm(sentence.japanese, surfaceForm);
  // Only reading_retrieval names the dictionary form — cloze hides the word
  // itself pre-reveal, so spelling out its lemma would give the answer away.
  const showDictionaryForm =
    !isCloze &&
    !revealed &&
    !!vocabularyItem.expression &&
    surfaceForm !== vocabularyItem.expression;
  return (
    <>
      <div className="jp jp-lg">
        {before}
        <mark>{isCloze && !revealed ? '_____' : target || surfaceForm}</mark>
        {after}
      </div>
      {showDictionaryForm ? (
        <div className="muted">Dictionary form: {vocabularyItem.expression}</div>
      ) : null}
      {isCloze && !revealed && sentence.translation ? (
        <div className="muted">{sentence.translation}</div>
      ) : null}
      {!revealed ? (
        <button type="button" onClick={onReveal}>
          {isCloze ? 'Reveal word' : showDictionaryForm ? 'Reveal dictionary reading' : 'Reveal reading'}
        </button>
      ) : (
        <>
          <div className="jp">{vocabularyItem.reading || '(no reading recorded)'}</div>
          {vocabularyItem.meaning ? (
            <div className="muted">{vocabularyItem.meaning}</div>
          ) : null}
          {sentence.readingOnly ? <div className="jp muted">{sentence.readingOnly}</div> : null}
          {sentence.translation ? <div className="muted">{sentence.translation}</div> : null}
        </>
      )}
    </>
  );
}

/**
 * Reading production (Phase 7.9, docs brief §12): the "production ladder"'s
 * first rung — same word/sentence as reading_retrieval, but the learner
 * types the reading instead of just revealing it, so recall is checked
 * (auto, via isReadingAnswerCorrect) rather than self-assessed from a
 * shown answer. The 4-point self-rate afterward stays the actual scheduling
 * signal, same as every other card type — correctness is recorded
 * (Review.responseRaw/expectedAnswer, threaded up via onCheck) as
 * supplementary evidence, not used to auto-pick a rating.
 *
 * When the word appears inflected in the sentence (頑張って for 頑張る) the
 * highlighted text alone doesn't say whether the dictionary reading or the
 * in-context one is wanted — `sentence_transformation` is the card that
 * tests producing the inflected form. So this card names the dictionary
 * form explicitly *and* accepts the in-context reading pulled from
 * `inlineReading` (`surfaceReadingFromInline`), so reading 頑張って off the
 * screen as がんばって is never marked wrong. `onCheck`'s second argument is
 * whichever reading the answer was actually graded against, recorded as
 * `Review.expectedAnswer` (see `typedResponseExpected`).
 */
function ReadingProductionCard({
  sentence,
  vocabularyItem,
  surfaceForm,
  revealed,
  onCheck,
}: {
  sentence: Sentence;
  vocabularyItem: VocabularyItem;
  surfaceForm: string;
  revealed: boolean;
  onCheck: (typedReading: string, gradedAgainst: string) => void;
}) {
  const [value, setValue] = useState('');
  const [wasCorrect, setWasCorrect] = useState(false);
  const [before, target, after] = splitOnSurfaceForm(sentence.japanese, surfaceForm);
  const isInflected =
    !!vocabularyItem.expression && surfaceForm !== vocabularyItem.expression;
  const inContextReading = surfaceReadingFromInline(sentence.inlineReading, surfaceForm);
  const acceptableReadings = [
    vocabularyItem.reading,
    ...(inContextReading ? [inContextReading] : []),
  ].filter((reading): reading is string => reading.length > 0);

  return (
    <>
      <div className="jp jp-lg">
        {before}
        <mark>{target || surfaceForm}</mark>
        {after}
      </div>
      {isInflected ? (
        <div className="muted">Dictionary form: {vocabularyItem.expression}</div>
      ) : null}
      {!revealed ? (
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            const matched = acceptableReadings.find((reading) =>
              isReadingAnswerCorrect(value, reading),
            );
            setWasCorrect(Boolean(matched));
            onCheck(value, matched ?? vocabularyItem.reading);
          }}
        >
          <label>
            {isInflected ? 'Type the dictionary reading' : 'Type the reading'}
            <input
              type="text"
              value={value}
              autoComplete="off"
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <button type="submit">Check</button>
        </form>
      ) : (
        <>
          <div className="muted">{wasCorrect ? '✓ Correct' : '✗ Not quite'}</div>
          {!wasCorrect ? (
            <div className="muted">
              You typed: <span className="jp">{value.trim() || '(blank)'}</span>
            </div>
          ) : null}
          <div className="jp">{vocabularyItem.reading || '(no reading recorded)'}</div>
          {vocabularyItem.meaning ? (
            <div className="muted">{vocabularyItem.meaning}</div>
          ) : null}
        </>
      )}
    </>
  );
}

/**
 * Contextual conjugation (docs/STATUS.md — supersedes Phase 7.9b's per-word
 * "sentence transformation"): the sentence is shown with the target word
 * blanked, the dictionary form and the form-name are given, and the learner
 * types the reading of the form *this sentence uses*. The form is never
 * forced — it's whichever one `identifyConjugationForm` found this occurrence
 * to be in (see getSentenceConjugationCandidates). Same typed-input + check
 * + reveal + self-rate shape as ReadingProductionCard; accepts either the
 * in-context inflected reading or the engine's own (candidate.expectedReadings),
 * and `onCheck`'s second argument is the reading actually matched, threaded up
 * as `Review.expectedAnswer` (see `typedResponseExpected`).
 */
function SentenceConjugationCard({
  candidate,
  revealed,
  onCheck,
}: {
  candidate: SentenceConjugationCandidate;
  revealed: boolean;
  onCheck: (typedReading: string, gradedAgainst: string) => void;
}) {
  const [value, setValue] = useState('');
  const [wasCorrect, setWasCorrect] = useState(false);
  const { vocabularyItem, sentence, surfaceForm, form, expectedReadings } = candidate;
  const [before, , after] = splitOnSurfaceForm(sentence.japanese, surfaceForm);

  return (
    <>
      <div className="jp jp-lg">
        {before}
        <mark>{revealed ? surfaceForm : '_____'}</mark>
        {after}
      </div>
      <div className="muted">Dictionary form: {vocabularyItem.expression}</div>
      <div className="muted">Produce: {form.label}</div>
      {!revealed ? (
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            const matched = expectedReadings.find((reading) =>
              isReadingAnswerCorrect(value, reading),
            );
            setWasCorrect(Boolean(matched));
            onCheck(value, matched ?? expectedReadings[0]!);
          }}
        >
          <label>
            Type the reading of the {form.label.toLowerCase()}
            <input
              type="text"
              value={value}
              autoComplete="off"
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <button type="submit">Check</button>
        </form>
      ) : (
        <>
          <div className="muted">{wasCorrect ? '✓ Correct' : '✗ Not quite'}</div>
          {!wasCorrect ? (
            <div className="muted">
              You typed: <span className="jp">{value.trim() || '(blank)'}</span>
            </div>
          ) : null}
          <div className="jp">{surfaceForm}</div>
          <div className="jp">{expectedReadings[0]}</div>
          {vocabularyItem.meaning ? (
            <div className="muted">{vocabularyItem.meaning}</div>
          ) : null}
        </>
      )}
    </>
  );
}

const PITCH_ACCENT_PATTERN_LABELS: Record<PitchAccentPattern, string> = {
  heiban: 'Heiban (平板)',
  atamadaka: 'Atamadaka (頭高)',
  nakadaka: 'Nakadaka (中高)',
  odaka: 'Odaka (尾高)',
};

/**
 * One pitch-accent choice on the `pitch_accent` card, drawn in the NHK /
 * OJAD textbook convention: an overline sits above every high mora and ends
 * in a downward stroke at the downstep, so each button reads as a single
 * whole contour (a word falls once at most) rather than a list of events.
 * A trailing dot is the following particle — high only for heiban, which is
 * what separates it from odaka (identical within the word itself). Shape
 * comes straight from `expectedPitchShape`, the same function the grader
 * and `PitchAccentDiagram` use.
 */
function PitchChoiceContour({ morae, position }: { morae: string[]; position: number }) {
  const shape = expectedPitchShape(morae.length, position);
  const particleHigh = position === 0;
  return (
    <span className="pa-choice jp" aria-hidden="true">
      {morae.map((mora, index) => {
        const high = shape[index] === 'h';
        const fallsAfter =
          high && (shape[index + 1] === 'l' || (index === morae.length - 1 && !particleHigh));
        return (
          <span
            key={index}
            className="pa-choice-mora"
            data-c={high ? 'h' : 'l'}
            data-fall={fallsAfter ? '' : undefined}
          >
            {mora}
          </span>
        );
      })}
      <span className="pa-choice-mora pa-choice-particle" data-c={particleHigh ? 'h' : 'l'}>
        ・
      </span>
    </span>
  );
}

/**
 * Pitch accent, audio-first: the learner loops the native realization of
 * the word (PitchAccentNativeAudio, shown before the answer, not just on
 * the reveal) and marks where the pitch drops on the word's own morae —
 * choices 0..moraCount, in mora order. getPitchAccentReviewCandidates's
 * doc comment covers eligibility and why the native clip is required.
 *
 * Shows the reading up front, unlike reading_retrieval/reading_production —
 * this card tests *how* to say a known reading, not recall of the reading.
 * Auto-graded (the app knows the drop position); same typed-response/
 * self-rate funnel every other selected-answer card uses — `onCheck`
 * passes the chosen and correct positions as strings, which
 * classifyReviewError compares to flag a miss as `pronunciation_difficulty`
 * the same way it does for reading_production/grammar_completion.
 */
function PitchAccentCard({
  candidate,
  revealed,
  onCheck,
}: {
  candidate: PitchAccentReviewCandidate;
  revealed: boolean;
  onCheck: (chosenPosition: string, correctPosition: string) => void;
}) {
  const { vocabularyItem, sentence, surfaceForm, audio, morae, correctPosition, correctLabel } =
    candidate;
  const [selected, setSelected] = useState<number | null>(null);
  const [before, target, after] = splitOnSurfaceForm(sentence.japanese, surfaceForm);

  // Drop positions 0..N. 0 = no downstep; N (= morae.length) is odaka —
  // indistinguishable from heiban within the word, which is why the native
  // clip (whose trailing particle drops for odaka, stays high for heiban)
  // plays before the learner answers. A word falls once at most, so each
  // choice is one whole contour, drawn textbook-style (overline over the
  // high morae, a vertical stroke at the downstep) by PitchChoiceContour.
  const positionChoices = Array.from({ length: morae.length + 1 }, (_, index) => index);
  const dropCaption = (position: number) =>
    position === 0 ? 'Stays high (no fall)' : `Falls after mora ${position}`;

  return (
    <>
      <div className="jp jp-lg">
        {before}
        <mark>{target || surfaceForm}</mark>
        {after}
      </div>
      <div className="jp">{vocabularyItem.reading}</div>

      <PitchAccentNativeAudio audio={audio} japanese={sentence.japanese} surfaceForm={surfaceForm} />

      {!revealed ? (
        <>
          <div className="muted">
            A word&rsquo;s pitch falls once at most. Listen, then mark where it falls.
          </div>
          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
            {positionChoices.map((position) => (
              <button
                key={position}
                type="button"
                className="pa-choice-button stack"
                style={{ gap: '0.2rem', alignItems: 'center' }}
                onClick={() => {
                  setSelected(position);
                  onCheck(String(position), String(correctPosition));
                }}
              >
                <PitchChoiceContour morae={morae} position={position} />
                <span className="muted" style={{ fontSize: '0.75rem' }}>
                  {dropCaption(position)}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="muted">
            {selected === correctPosition ? '✓ Correct' : '✗ Not quite'}
          </div>
          <div>
            {PITCH_ACCENT_PATTERN_LABELS[correctLabel]} —{' '}
            {correctPosition === 0 ? 'no downstep' : `downstep after mora ${correctPosition}`}
          </div>
          <PitchAccentDiagram
            reading={vocabularyItem.reading}
            position={vocabularyItem.pitchAccentPositions?.[0] ?? correctPosition}
          />
          <SentencePitchAccentRow
            japanese={sentence.japanese}
            sentenceId={sentence.id}
            highlightSurfaceForm={surfaceForm}
          />
          {(() => {
            const explanation = explainPitchAccent({
              expression: vocabularyItem.expression,
              reading: vocabularyItem.reading,
              partOfSpeech: vocabularyItem.partOfSpeech,
              position: vocabularyItem.pitchAccentPositions?.[0] ?? correctPosition,
              moraCount: morae.length,
            });
            return (
              <>
                <div className="muted">{explanation.patternGloss}</div>
                {explanation.ruleNote ? (
                  <div className="muted">{explanation.ruleNote}</div>
                ) : null}
              </>
            );
          })()}
          {vocabularyItem.meaning ? (
            <div className="muted">{vocabularyItem.meaning}</div>
          ) : null}
        </>
      )}
    </>
  );
}

/**
 * Audio comprehension (Phase 7.4, docs brief §5D): audio plays first with
 * the Japanese text hidden. Reveal is staged in two steps rather than one:
 * "Reveal text" first shows only the (karaoke-highlighted) Japanese, so the
 * learner can check whether they parsed the *audio* correctly before
 * meaning enters the picture; "Reveal translation" then shows the
 * translation and vocabulary together. Splitting these lets a learner tell
 * "I couldn't segment the audio" apart from "I heard it fine but didn't
 * know that word" instead of one undifferentiated self-rating — the parent
 * `revealed`/rating-buttons gate only fires at the second step, since the
 * exercise isn't done until meaning has been checked too. The audio button
 * stays available (and replayable) throughout.
 *
 * Playback speed (follow-up) reuses the same rate-select ShadowPage already
 * has, wired into NativeAudioButton's existing (previously unused here)
 * playbackRate prop. Once text is revealed, the sentence is rendered via
 * KaraokeSentenceText — the real sentence text, tokenized from its
 * vocabulary suggestions, with the currently-spoken token highlighted (and
 * its gloss shown) via lazily-computed forced alignment. It falls back to
 * plain static text on its own when alignment isn't available, so no
 * fallback branching is needed here.
 */
/**
 * Measured native-clip pitch track under a revealed audio card. Own
 * component so the (async, decode-backed) load doesn't add a hook to the
 * ReviewPage body — mounts only when there's an audio card to show it for.
 */
function ReviewPitchContour({ audio }: { audio: SentenceAudio }) {
  const [payload, setPayload] = useState<PitchAnalysisPayload>();
  useEffect(() => {
    let cancelled = false;
    setPayload(undefined);
    void loadOrComputeReferencePitch(
      audio.id,
      audio.blob,
      getReferencePitchTrack,
      saveReferencePitchTrack,
    ).then((result) => {
      if (!cancelled) setPayload(result);
    });
    return () => {
      cancelled = true;
    };
  }, [audio.id, audio.blob]);
  return <MeasuredPitchContour payload={payload} />;
}

function AudioComprehensionCard({
  sentence,
  audio,
  revealed,
  onReveal,
  onReplay,
  playbackRate,
  onPlaybackRateChange,
}: {
  sentence: Sentence;
  audio: SentenceAudio;
  revealed: boolean;
  onReveal: () => void;
  /** Called on every play *after* the first — the first play is the exercise itself, not assistance. */
  onReplay: () => void;
  playbackRate: number;
  onPlaybackRateChange: (value: number) => void;
}) {
  const playCountRef = useRef(0);
  const [textRevealed, setTextRevealed] = useState(false);
  return (
    <>
      <div className="row" style={{ alignItems: 'center' }}>
        <NativeAudioButton
          audio={audio}
          displayLabel="Play audio"
          playbackRate={playbackRate}
          onPlay={() => {
            playCountRef.current += 1;
            if (playCountRef.current > 1) onReplay();
          }}
        />
        <label>
          Speed
          <select
            value={playbackRate}
            onChange={(event) => onPlaybackRateChange(Number(event.target.value))}
          >
            {PLAYBACK_SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value === 1 ? '1× (normal)' : `${value}×`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!textRevealed ? (
        <>
          <p className="muted">Listen and see how much you understand before revealing.</p>
          <button type="button" onClick={() => setTextRevealed(true)}>
            Reveal text
          </button>
        </>
      ) : (
        <>
          <KaraokeSentenceText
            audio={audio}
            japanese={sentence.japanese}
            readingOnly={sentence.readingOnly}
            vocabularySuggestions={sentence.vocabularySuggestions}
            targetVocabulary={sentence.targetVocabulary}
          />
          {!revealed ? (
            <button type="button" onClick={onReveal}>
              Reveal translation
            </button>
          ) : (
            <>
              <div>{sentence.translation || '(no translation)'}</div>
              <VocabChips items={sentence.targetVocabulary} />
            </>
          )}
        </>
      )}
    </>
  );
}

/**
 * Word-in-context listening (user request; reworked 2026-09-02): tier 1 of
 * the listening ladder. An audio cloze — the listening analog of `cloze`.
 * The whole sentence is the stimulus (not an isolated word span, which made
 * a 2-mora function word like いい an unfair vacuum test and degraded to
 * bare whole-sentence playback whenever forced alignment couldn't isolate
 * the word). Staged like `listening`:
 *   1. Audio only, text hidden — attempt to parse the clip.
 *   2. "Reveal sentence" — the sentence with the target occurrence blanked,
 *      plus its translation as the cloze constraint; recall the missing
 *      word from sound + context. The isolated-word loop is offered here as
 *      optional scaffolding (`SegmentLoopPlayer wordOnly` — shows nothing
 *      when it can't isolate), never as the test.
 *   3. "Reveal answer" — the word filled in, reading, meaning, dict form.
 * The 4-point self-rate after step 3 is the scheduling signal, same as the
 * other reveal-based cards; the full-sentence `listening` card (tier 2)
 * stays gated behind every one of these.
 */
function WordListeningCard({
  candidate,
  revealed,
  onReveal,
  onReplay,
  playbackRate,
  onPlaybackRateChange,
}: {
  candidate: WordListeningCandidate;
  revealed: boolean;
  onReveal: () => void;
  /** Called on every play *after* the first — the first play is the exercise itself. */
  onReplay: () => void;
  playbackRate: number;
  onPlaybackRateChange: (value: number) => void;
}) {
  const { sentence, audio, surfaceForm, vocabularyItem } = candidate;
  const [before, target, after] = splitOnSurfaceForm(sentence.japanese, surfaceForm);
  const isInflected =
    !!vocabularyItem.expression && surfaceForm !== vocabularyItem.expression;
  const playCountRef = useRef(0);
  const [sentenceRevealed, setSentenceRevealed] = useState(false);
  return (
    <>
      <div className="row" style={{ alignItems: 'center' }}>
        <NativeAudioButton
          audio={audio}
          displayLabel="Play sentence"
          playbackRate={playbackRate}
          onPlay={() => {
            playCountRef.current += 1;
            if (playCountRef.current > 1) onReplay();
          }}
        />
        <label>
          Speed{' '}
          <select
            value={playbackRate}
            onChange={(event) => onPlaybackRateChange(Number(event.target.value))}
          >
            {PLAYBACK_SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value === 1 ? '1× (normal)' : `${value}×`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!sentenceRevealed ? (
        <>
          <p className="muted">
            Listen to the whole sentence, then reveal which word to identify.
          </p>
          <button type="button" onClick={() => setSentenceRevealed(true)}>
            Reveal sentence
          </button>
        </>
      ) : !revealed ? (
        <>
          <div className="jp jp-lg">
            {before}
            <mark>_____</mark>
            {after}
          </div>
          {sentence.translation ? <div className="muted">{sentence.translation}</div> : null}
          <p className="muted">Which word fills the blank? Recall its reading and meaning.</p>
          <SegmentLoopPlayer
            audio={audio}
            japanese={sentence.japanese}
            surfaceForm={surfaceForm}
            loopLabel="Hear just the word"
            loopingLabel="Looping word…"
            wordOnly
          />
          <button type="button" onClick={onReveal}>
            Reveal answer
          </button>
        </>
      ) : (
        <>
          <div className="jp jp-lg">
            {before}
            <mark>{target || surfaceForm}</mark>
            {after}
          </div>
          <div className="jp">{vocabularyItem.reading || '(no reading recorded)'}</div>
          {vocabularyItem.meaning ? (
            <div className="muted">{vocabularyItem.meaning}</div>
          ) : null}
          {isInflected ? (
            <div className="muted">Dictionary form: {vocabularyItem.expression}</div>
          ) : null}
          {sentence.translation ? <div className="muted">{sentence.translation}</div> : null}
        </>
      )}
    </>
  );
}

/**
 * Contrastive pair review (Phase 7.7, docs brief §10): both confusable
 * words shown together, each highlighted (not blanked — the target word
 * stays visible, same as reading_retrieval) in one of its own sentences, so
 * the learner has to recall and distinguish both readings/meanings at once
 * rather than reviewing either word in isolation. One shared reveal for the
 * pair, one self-rating — the evidence is "could this learner tell these
 * two apart," not either word's individual recall (already covered by
 * reading_retrieval/cloze).
 */
function ContrastivePairCard({
  candidate,
  revealed,
  onReveal,
}: {
  candidate: ConfusionPairCandidate;
  revealed: boolean;
  onReveal: () => void;
}) {
  return (
    <>
      {[candidate.itemA, candidate.itemB].map((item) => {
        const [before, target, after] = splitOnSurfaceForm(
          item.sentence.japanese,
          item.surfaceForm,
        );
        return (
          <div key={item.vocabularyItem.id} className="stack">
            <div className="jp jp-lg">
              {before}
              <mark>{target || item.surfaceForm}</mark>
              {after}
            </div>
            {revealed ? (
              <>
                <div className="jp">{item.vocabularyItem.reading || '(no reading recorded)'}</div>
                {item.vocabularyItem.meaning ? (
                  <div className="muted">{item.vocabularyItem.meaning}</div>
                ) : null}
                {item.sentence.readingOnly ? (
                  <div className="jp muted">{item.sentence.readingOnly}</div>
                ) : null}
                {item.sentence.translation ? (
                  <div className="muted">{item.sentence.translation}</div>
                ) : null}
              </>
            ) : null}
          </div>
        );
      })}
      {!revealed ? (
        <button type="button" onClick={onReveal}>
          Reveal
        </button>
      ) : null}
    </>
  );
}

/**
 * Grammar comprehension (grammar-learning system Phase 5, design brief
 * §11A): show a native sentence containing the tracked pattern, ask what
 * it contributes, reveal the pattern's own meaning/explanation alongside
 * the sentence translation — self-rated, no typed/selected answer, same
 * "bare self-rating, no auto-classification" shape as plain
 * comprehension/reading_in_context.
 */
function GrammarComprehensionCard({
  candidate,
  revealed,
  onReveal,
}: {
  candidate: GrammarReviewCandidate;
  revealed: boolean;
  onReveal: () => void;
}) {
  const { pattern, sentence } = candidate;
  return (
    <>
      <div className="jp jp-lg">{sentence.japanese}</div>
      <div className="muted">
        What does <span className="jp">{pattern.canonicalName}</span> contribute here?
      </div>
      {!revealed ? (
        <button type="button" onClick={onReveal}>
          Reveal
        </button>
      ) : (
        <>
          {pattern.shortMeaning ? <div>{pattern.shortMeaning}</div> : null}
          {pattern.explanation ? <div className="muted">{pattern.explanation}</div> : null}
          {pattern.structuralNotes ? (
            <div className="muted">{pattern.structuralNotes}</div>
          ) : null}
          {sentence.translation ? <div className="muted">{sentence.translation}</div> : null}
        </>
      )}
    </>
  );
}

/**
 * Grammar production (docs/ROADMAP.md "Grammar production ladder"): the
 * output rung the grammar system was missing — recognition cards
 * (comprehension/completion/contrast) all ask the learner to *identify* a
 * construction; this asks them to *use* one. Show the pattern's meaning,
 * take a free-form sentence, then reveal a model (one of the learner's own
 * tagged encounters of the pattern) to self-rate against. The
 * `grammarPatternUsedIn` check on reveal is a "did you actually use the
 * construction" hint only — meaning and naturalness are the learner's own
 * call, so this stays a self-rated card (no auto ✓/✗ funnel into
 * `classifyReviewError`, unlike grammar_completion). See
 * GRAMMAR_PRODUCTION_ACTIVITY_TYPES.
 */
function GrammarProductionCard({
  candidate,
  revealed,
  onReveal,
}: {
  candidate: GrammarReviewCandidate;
  revealed: boolean;
  onReveal: (value: string) => void;
}) {
  const { pattern, sentence } = candidate;
  const [text, setText] = useState('');
  const used = grammarPatternUsedIn(text, pattern.canonicalName);
  return (
    <>
      <div className="muted">
        Write a sentence that uses <span className="jp">{pattern.canonicalName}</span>.
      </div>
      {pattern.shortMeaning ? <div>{pattern.shortMeaning}</div> : null}
      <textarea
        className="jp"
        rows={2}
        value={text}
        placeholder="Your sentence…"
        onChange={(event) => setText(event.target.value)}
        disabled={revealed}
      />
      {!revealed ? (
        <button type="button" onClick={() => onReveal(text.trim())}>
          Reveal model
        </button>
      ) : (
        <>
          <div className="muted">
            {used
              ? `✓ ${pattern.canonicalName} appears in your sentence.`
              : `Couldn't spot ${pattern.canonicalName} in your sentence — check the construction.`}
          </div>
          <div className="muted">Model (one of your encounters):</div>
          <div className="jp jp-lg">{sentence.japanese}</div>
          {sentence.translation ? <div className="muted">{sentence.translation}</div> : null}
          {pattern.explanation ? <div className="muted">{pattern.explanation}</div> : null}
          {pattern.structuralNotes ? (
            <div className="muted">{pattern.structuralNotes}</div>
          ) : null}
        </>
      )}
    </>
  );
}

/**
 * Grammar completion (grammar-learning system Phase 5, design brief §11E):
 * multiple choice among the tracked pattern and up to three distractors
 * (GrammarReviewCandidate.choices, precomputed in ReviewPage's scope
 * query). Blanks the pattern's surface form when it appears verbatim in
 * the sentence (blankPatternInSentence — best-effort, no real span data
 * exists yet); otherwise shows the full sentence and asks which
 * construction it uses, rather than guessing at a blank. Auto-graded (the
 * app knows the right choice), but still funnels through the same
 * typed-response/self-rate flow every other typed/selected card uses —
 * `onCheck` sets `typedResponse` to the chosen pattern's name, which
 * `classifyReviewError` then compares against `expectedAnswer` the same
 * way it already does for reading_production/sentence_transformation.
 * Degrades to a plain reveal (like GrammarComprehensionCard) when fewer
 * than two choices exist — a fresh corpus with only one tracked pattern
 * has nothing to contrast against yet.
 */
function GrammarCompletionCard({
  candidate,
  revealed,
  onCheck,
}: {
  candidate: GrammarReviewCandidate;
  revealed: boolean;
  onCheck: (chosenCanonicalName: string) => void;
}) {
  const { pattern, sentence, choices } = candidate;
  const [selected, setSelected] = useState<string | null>(null);
  const blank = blankPatternInSentence(sentence.japanese, pattern.canonicalName);

  if (choices.length < 2) {
    return (
      <>
        <div className="jp jp-lg">{sentence.japanese}</div>
        <div className="muted">
          What does <span className="jp">{pattern.canonicalName}</span> contribute here?
        </div>
        {!revealed ? (
          <button type="button" onClick={() => onCheck('')}>
            Reveal
          </button>
        ) : (
          <>
            {pattern.shortMeaning ? <div>{pattern.shortMeaning}</div> : null}
            {sentence.translation ? <div className="muted">{sentence.translation}</div> : null}
          </>
        )}
      </>
    );
  }

  if (!revealed) {
    return (
      <>
        <div className="jp jp-lg">
          {blank ? (
            <>
              {blank.before}
              <mark>_____</mark>
              {blank.after}
            </>
          ) : (
            sentence.japanese
          )}
        </div>
        <div className="muted">
          {blank
            ? 'Which construction fits the blank?'
            : 'Which construction does this sentence use?'}
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className="jp"
              onClick={() => {
                setSelected(choice.canonicalName);
                onCheck(choice.canonicalName);
              }}
            >
              {choice.canonicalName}
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="muted">
        {selected === pattern.canonicalName ? '✓ Correct' : '✗ Not quite'}
      </div>
      <div className="jp jp-lg">
        {blank ? (
          <>
            {blank.before}
            <mark>{pattern.canonicalName}</mark>
            {blank.after}
          </>
        ) : (
          sentence.japanese
        )}
      </div>
      {pattern.shortMeaning ? <div>{pattern.shortMeaning}</div> : null}
      {sentence.translation ? <div className="muted">{sentence.translation}</div> : null}
    </>
  );
}

/**
 * Grammar contrast (grammar-learning system Phase 9 slice, design brief
 * §11C): "can you tell these two apart," specifically for a
 * `GrammarRelationship`-linked pair the learner flagged as confusable via
 * the detail page — not "recall the right construction from an open pool"
 * (that's grammar_completion). Always exactly two choices by construction
 * (see ReviewPage's scope-building: a candidate only exists for a pattern
 * with at least one relationship), so unlike GrammarCompletionCard there's
 * no "fewer than two choices" degrade branch. Deliberately never blanks
 * the sentence — the point is recognizing which of two specific
 * constructions is actually present, not filling in a gap, and blanking
 * could erase the very distinction being tested (e.g. two patterns that
 * differ only outside the matched span). Same typed-response/self-rate
 * funnel as GrammarCompletionCard — `onCheck` sets `typedResponse` to the
 * chosen pattern's name for classifyReviewError to compare.
 */
function GrammarContrastCard({
  candidate,
  revealed,
  onCheck,
}: {
  candidate: GrammarReviewCandidate;
  revealed: boolean;
  onCheck: (chosenCanonicalName: string) => void;
}) {
  const { pattern, sentence, choices } = candidate;
  const [selected, setSelected] = useState<string | null>(null);

  if (!revealed) {
    return (
      <>
        <div className="jp jp-lg">{sentence.japanese}</div>
        <div className="muted">Which construction is used here?</div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className="jp"
              onClick={() => {
                setSelected(choice.canonicalName);
                onCheck(choice.canonicalName);
              }}
            >
              {choice.canonicalName}
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="muted">
        {selected === pattern.canonicalName ? '✓ Correct' : '✗ Not quite'}
      </div>
      <div className="jp jp-lg">{sentence.japanese}</div>
      {pattern.shortMeaning ? <div>{pattern.shortMeaning}</div> : null}
      {sentence.translation ? <div className="muted">{sentence.translation}</div> : null}
    </>
  );
}

