import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { KaraokeSentenceText } from '../components/KaraokeSentenceText';
import { NativeAudioButton } from '../components/NativeAudioButton';
import { VocabChips } from '../components/VocabChips';
import {
  computeVocabularyContextDiversity,
  countReviewsSince,
  deferUnreadySentenceReviews,
  ensureGrammarStudyItem,
  ensureStudyItem,
  ensureVocabularyStudyItem,
  getConfusionPairCandidates,
  getDb,
  getDueStudyItems,
  getSentenceFullReviewReadiness,
  getVocabularyTargetCandidates,
  pickContextSentenceForGrammarPattern,
  readSettings,
  recordReview,
  reportCardIssue,
  settleSessionStep,
  type ConfusionPairCandidate,
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
  conjugationFormsForWordClass,
  conjugationWordClassFromPartOfSpeech,
  type ConjugatedForm,
  type ConjugationWordClass,
} from '../lib/conjugation';
import {
  blankPatternInSentence,
  buildGrammarCompletionChoices,
} from '../lib/grammarPatterns';
import { hashString } from '../lib/ids';
import { computeMaturityLevel, MATURE_MIN_SCHEDULED_DAYS } from '../lib/maturity';
import { segmentIntoMorae } from '../lib/mora';
import { normalizeSentenceKey } from '../lib/normalize';
import {
  pitchPatternLabel,
  possiblePitchPatternsForMoraCount,
  type PitchAccentPattern,
} from '../lib/pitchAccentShape';
import { PLAYBACK_SPEEDS } from '../lib/recording';

/**
 * Phase 4 (docs/UNIFIED_APP_ARCHITECTURE.md §10) starts with two
 * sentence-subject activity types sharing one interaction (see JP, reveal
 * EN + vocab, self-rate) — real differentiation between them (e.g. showing
 * surrounding chapter context for reading_in_context) is deliberately
 * deferred, see STATUS.md.
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
 * Sentence transformation (Phase 7.9, sentence-transformations slice, docs
 * brief §12): subjectType stays `vocabularyItem` (a fourth activity type
 * alongside reading_retrieval/cloze/reading_production for the same
 * subject, distinguished by activityType like those three already are from
 * each other) — but eligibility is narrower: only words whose
 * `partOfSpeech` maps to a conjugation word class (see
 * conjugationWordClassFromPartOfSpeech, src/lib/conjugation.ts) and whose
 * conjugated form actually differs from the dictionary form. The first
 * slice fixed every word to a single form (plain past); which form gets
 * quizzed is now picked per word — deterministically, from a hash of the
 * vocabulary item's id, so the same word always asks the same form (stable
 * across reloads/re-renders) while different words spread across the 13
 * verb/10 adjective forms `conjugationFormsForWordClass` already exposes —
 * see pickTransformationTarget.
 */
const TRANSFORMATION_ACTIVITY_TYPES: StudyActivityType[] = ['sentence_transformation'];

/**
 * Pitch-accent review (docs/STATUS.md): subjectType stays `vocabularyItem`,
 * like reading_retrieval/cloze/reading_production/sentence_transformation —
 * but eligibility is narrower still: only words with dictionary-backed
 * `pitchAccentPositions` data (Kanjium, via
 * scripts/backfill-pitch-accent.ts — a subset of confirmed vocabulary, not
 * all of it). Multiple choice among the pitch-accent categories
 * (heiban/atamadaka/nakadaka/odaka) that are actually distinguishable for
 * the word's own mora count (possiblePitchPatternsForMoraCount,
 * src/lib/pitchAccentShape.ts) — not a fixed 4-way choice, since e.g.
 * nakadaka/odaka are structurally impossible for a 1-mora word and
 * offering them would be an unfair distractor. See
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

const ACTIVITY_LABELS: Record<string, string> = {
  comprehension: 'Comprehension',
  reading_in_context: 'Reading in context',
  reading_retrieval: 'Reading retrieval',
  cloze: 'Cloze',
  reading_production: 'Reading production',
  listening: 'Listening',
  contrastive: 'Contrastive pair',
  sentence_transformation: 'Sentence transformation',
  pitch_accent: 'Pitch accent',
  grammar_comprehension: 'Grammar comprehension',
  grammar_completion: 'Grammar completion',
  grammar_contrast: 'Grammar contrast',
};

interface SentenceTransformationCandidate {
  vocabularyItem: VocabularyItem;
  sentence: Sentence;
  surfaceForm: string;
  wordClass: ConjugationWordClass;
  target: ConjugatedForm;
  formLabel: string;
}

/**
 * Picks which conjugation form a word gets quizzed on: starts at a form
 * index derived from a stable hash of the vocabulary item's id (so the
 * same word always picks the same form), then tries the remaining forms in
 * order if the chosen one doesn't actually conjugate to anything (some
 * forms aren't implemented for every word class) or produces no visible
 * change from the dictionary form — same skip conditions the original
 * fixed-to-plain-past version used, just no longer giving up after one try.
 */
function pickTransformationTarget(
  vocabularyItem: VocabularyItem,
  wordClass: ConjugationWordClass,
): { target: ConjugatedForm; formLabel: string } | null {
  const forms = conjugationFormsForWordClass(wordClass);
  if (forms.length === 0) return null;
  const startIndex = Number.parseInt(hashString(vocabularyItem.id), 16) % forms.length;
  for (let offset = 0; offset < forms.length; offset += 1) {
    const form = forms[(startIndex + offset) % forms.length]!;
    const target = conjugate(
      vocabularyItem.expression,
      vocabularyItem.reading,
      wordClass,
      form.key,
    );
    if (!target) continue;
    if (target.expression === vocabularyItem.expression && target.reading === vocabularyItem.reading) {
      continue;
    }
    return { target, formLabel: form.label };
  }
  return null;
}

/**
 * Pure filter over already-fetched vocabulary-target candidates (no DB
 * access needed, unlike getConfusionPairCandidates) — a word is a
 * candidate only if its partOfSpeech is conjugable and pickTransformationTarget
 * finds a usable form for it.
 */
function getSentenceTransformationCandidates(
  candidates: VocabularyTargetCandidate[],
): SentenceTransformationCandidate[] {
  const result: SentenceTransformationCandidate[] = [];
  for (const candidate of candidates) {
    const wordClass = conjugationWordClassFromPartOfSpeech(
      candidate.vocabularyItem.partOfSpeech,
    );
    if (!wordClass) continue;
    const picked = pickTransformationTarget(candidate.vocabularyItem, wordClass);
    if (!picked) continue;
    result.push({ ...candidate, wordClass, target: picked.target, formLabel: picked.formLabel });
  }
  return result;
}

interface PitchAccentReviewCandidate {
  vocabularyItem: VocabularyItem;
  sentence: Sentence;
  surfaceForm: string;
  moraCount: number;
  correctLabel: PitchAccentPattern;
  /** Every pattern distinguishable at this word's mora count, in a per-word-stable shuffled order (see below) — not the raw fixed enum order, so the correct answer isn't always in the same button position. */
  choices: PitchAccentPattern[];
}

/**
 * Pure filter over already-fetched vocabulary-target candidates (no DB
 * access needed), mirroring getSentenceTransformationCandidates's shape —
 * a word is a candidate only if it has dictionary pitch-accent data and a
 * segmentable reading. Choice order is shuffled by a stable per-word hash
 * (same sort-key mechanic buildGrammarCompletionChoices uses for its own
 * final ordering step) rather than ranked/sliced the way grammar's
 * corpus-scale distractor pool needs — here the choice set is already
 * small and fully determined by moraCount, so only ordering varies.
 */
function getPitchAccentReviewCandidates(
  candidates: VocabularyTargetCandidate[],
): PitchAccentReviewCandidate[] {
  const result: PitchAccentReviewCandidate[] = [];
  for (const candidate of candidates) {
    const positions = candidate.vocabularyItem.pitchAccentPositions;
    if (!positions?.length) continue;
    const moraCount = segmentIntoMorae(candidate.vocabularyItem.reading).length;
    if (moraCount === 0) continue;
    const correctLabel = pitchPatternLabel(positions[0]!, moraCount);
    const choices = [...possiblePitchPatternsForMoraCount(moraCount)].sort((a, b) => {
      const ha = Number.parseInt(hashString(`${candidate.vocabularyItem.id}:order:${a}`), 16);
      const hb = Number.parseInt(hashString(`${candidate.vocabularyItem.id}:order:${b}`), 16);
      return ha - hb;
    });
    result.push({ ...candidate, moraCount, correctLabel, choices });
  }
  return result;
}

/** Same normalization `normalizeSentenceKey` uses for sentence-identity matching (NFC, whitespace-insensitive) — reused here for typed-reading comparison since the requirements coincide. */
function isReadingAnswerCorrect(typed: string, expected: string): boolean {
  const normalizedTyped = normalizeSentenceKey(typed);
  return normalizedTyped.length > 0 && normalizedTyped === normalizeSentenceKey(expected);
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
  /** Set only for contrastive-pair cards (Phase 7.7). */
  confusionPair?: ConfusionPairCandidate;
  /** Set only for sentence-transformation cards (Phase 7.9). */
  transformation?: SentenceTransformationCandidate;
  /** Set only for pitch-accent cards. */
  pitchAccent?: PitchAccentReviewCandidate;
  /** Set only for grammar-pattern cards (grammar-learning system Phase 5). */
  grammar?: GrammarReviewCandidate;
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
  vocabularyTargetCandidates: VocabularyTargetCandidate[];
  existingVocabularyItems: StudyItem[];
  audioCandidates: AudioCandidate[];
  existingAudioItems: StudyItem[];
  confusionPairCandidates: ConfusionPairCandidate[];
  existingConfusionItems: StudyItem[];
  sentenceTransformationCandidates: SentenceTransformationCandidate[];
  existingTransformationItems: StudyItem[];
  pitchAccentCandidates: PitchAccentReviewCandidate[];
  existingPitchAccentItems: StudyItem[];
  grammarCandidates: GrammarReviewCandidate[];
  existingGrammarItems: StudyItem[];
  grammarContrastCandidates: GrammarReviewCandidate[];
  existingGrammarContrastItems: StudyItem[];
}

function buildActivityDescriptors(scope: ReviewScope): ActivityDescriptor[] {
  return [
    defineActivityDescriptor<Sentence>({
      key: 'sentence',
      activityTypes: SENTENCE_ACTIVITY_TYPES,
      candidates: scope.sentences,
      existingItems: scope.existingSentenceItems,
      subjectId: (sentence) => sentence.id,
      buildCard: (studyItem, sentence) => ({ studyItem, sentence }),
      ensure: (sentence, activityType) => ensureStudyItem('sentence', sentence.id, activityType),
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
    defineActivityDescriptor<SentenceTransformationCandidate>({
      key: 'transformation',
      activityTypes: TRANSFORMATION_ACTIVITY_TYPES,
      candidates: scope.sentenceTransformationCandidates,
      existingItems: scope.existingTransformationItems,
      subjectId: (candidate) => candidate.vocabularyItem.id,
      buildCard: (studyItem, candidate) => ({
        studyItem,
        sentence: candidate.sentence,
        transformation: candidate,
      }),
      ensure: (candidate, activityType) =>
        ensureVocabularyStudyItem(candidate.vocabularyItem.id, activityType),
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
  const [mnemonicVisible, setMnemonicVisible] = useState(false);
  const [assistanceUsed, setAssistanceUsed] = useState<Set<ReviewAssistance>>(
    () => new Set(),
  );
  /** Set only by reading_production's Check step; recorded as Review.responseRaw on rate. */
  const [typedResponse, setTypedResponse] = useState('');
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

    const sentenceTransformationCandidates = getSentenceTransformationCandidates(
      vocabularyTargetCandidates,
    );
    const transformationVocabularyItemIdSet = new Set(
      sentenceTransformationCandidates.map((candidate) => candidate.vocabularyItem.id),
    );
    const existingTransformationItems = (
      await db.studyItems
        .where('activityType')
        .anyOf(TRANSFORMATION_ACTIVITY_TYPES)
        .toArray()
    ).filter(
      (item) =>
        item.subjectType === 'vocabularyItem' &&
        transformationVocabularyItemIdSet.has(item.subjectId),
    );

    const pitchAccentCandidates = getPitchAccentReviewCandidates(vocabularyTargetCandidates);
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
    if (!bookId) {
      const allGrammarPatternStudyItems = (
        await db.studyItems
          .where('activityType')
          .anyOf([...GRAMMAR_ACTIVITY_TYPES, ...GRAMMAR_CONTRAST_ACTIVITY_TYPES])
          .toArray()
      ).filter((item) => item.subjectType === 'grammarPattern');
      const grammarStudyItems = allGrammarPatternStudyItems.filter((item) =>
        GRAMMAR_ACTIVITY_TYPES.includes(item.activityType),
      );
      const grammarContrastStudyItems = allGrammarPatternStudyItems.filter(
        (item) => item.activityType === 'grammar_contrast',
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
      }
    }

    return {
      book,
      sentences,
      existingSentenceItems,
      vocabularyTargetCandidates,
      existingVocabularyItems,
      audioCandidates,
      existingAudioItems,
      confusionPairCandidates,
      existingConfusionItems,
      sentenceTransformationCandidates,
      existingTransformationItems,
      pitchAccentCandidates,
      existingPitchAccentItems,
      grammarCandidates,
      existingGrammarItems,
      grammarContrastCandidates,
      existingGrammarContrastItems,
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
      const sentenceReadiness = await getSentenceFullReviewReadiness(
        scope.sentences.map((sentence) => sentence.id),
      );

      const dueByDescriptor = await Promise.all(
        descriptors.map((descriptor) =>
          getDueStudyItems(descriptor.activityTypes, {
            subjectIds: descriptor.candidates.map(descriptor.subjectId),
            graduationMinScheduledDays: settings.graduationMinScheduledDays,
          }),
        ),
      );

      const due: QueueCard[] = [];
      descriptors.forEach((descriptor, index) => {
        const byId = new Map(
          descriptor.candidates.map((candidate) => [descriptor.subjectId(candidate), candidate]),
        );
        for (const studyItem of dueByDescriptor[index]!) {
          const candidate = byId.get(studyItem.subjectId);
          if (candidate) due.push(descriptor.buildCard(studyItem, candidate));
        }
      });
      due.sort((a, b) => a.studyItem.fsrsState.due.localeCompare(b.studyItem.fsrsState.due));

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
          // full-sentence study item lazily seeded — existing ones are
          // handled by deferUnreadySentenceReviews above.
          if (descriptor.key === 'sentence' && sentenceReadiness.get(subjectId) === false) {
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
      setQueue(due);
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
    setMnemonicVisible(false);
    setAssistanceUsed(new Set());
    setTypedResponse('');
    setReportingIssue(false);
    setIssueNote('');
    setIssueReported(false);
  }, [current?.studyItem.id]);

  // Mnemonic scaffolding (Phase 7.5, brief §7/§6): shown unprompted only
  // for a vocabulary-target card whose own dimension is still fragile
  // (few contexts, no long-interval success yet) — otherwise it's still
  // available, just behind a button, not auto-shown. Computed from live
  // data each time the card changes rather than cached on the card, since
  // maturity can change between reviews.
  useEffect(() => {
    const target = current?.target;
    const fsrsState = current?.studyItem.fsrsState;
    if (!target || !fsrsState) return;
    let cancelled = false;
    void (async () => {
      try {
        const diversity = await computeVocabularyContextDiversity(target.vocabularyItem.id);
        const level = computeMaturityLevel(diversity, {
          hasLongIntervalSuccess:
            fsrsState.state === 'review' &&
            fsrsState.scheduledDays >= MATURE_MIN_SCHEDULED_DAYS,
        });
        if (!cancelled && level === 'fragile') setMnemonicVisible(true);
      } catch {
        // Best-effort UI enhancement (e.g. the db closed mid-query because
        // the page unmounted) — nothing to recover, mnemonic just stays
        // gated behind its button instead of auto-showing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current?.studyItem.id, current?.target]);

  function markAssistance(kind: ReviewAssistance) {
    setAssistanceUsed((current) => (current.has(kind) ? current : new Set(current).add(kind)));
  }

  async function handleRate(rating: ReviewRating) {
    if (!current || submitting) return;
    setSubmitting(true);
    try {
      const expectedAnswerValue = current.transformation
        ? current.transformation.target.reading
        : current.pitchAccent
          ? current.pitchAccent.correctLabel
          : current.grammar
            ? current.grammar.pattern.canonicalName
            : current.target?.vocabularyItem.reading;
      await recordReview({
        studyItemId: current.studyItem.id,
        rating,
        assistance: assistanceUsed.size > 0 ? [...assistanceUsed] : undefined,
        responseRaw: typedResponse || undefined,
        expectedAnswer: typedResponse ? expectedAnswerValue : undefined,
      });
      setQueue((q) => q.slice(1));

      // Session-aware auto-advance (2026-08-26 follow-up): once this
      // review completes the active session's `review` step's target
      // count, settle the step and jump straight to the next one, instead
      // of leaving the learner to notice and go back to Mark it complete.
      if (activeSession && reviewStep?.targetCount) {
        const doneCount = (reviewsDoneThisStep ?? 0) + 1;
        if (doneCount >= reviewStep.targetCount) {
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
                onCheck={(value) => {
                  setTypedResponse(value);
                  setRevealed(true);
                }}
                mnemonicVisible={mnemonicVisible}
                onShowMnemonic={() => {
                  setMnemonicVisible(true);
                  markAssistance('mnemonic_shown');
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
                mnemonicVisible={mnemonicVisible}
                onShowMnemonic={() => {
                  setMnemonicVisible(true);
                  markAssistance('mnemonic_shown');
                }}
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
            ) : current.confusionPair ? (
              <ContrastivePairCard
                candidate={current.confusionPair}
                revealed={revealed}
                onReveal={() => setRevealed(true)}
              />
            ) : current.transformation ? (
              <SentenceTransformationCard
                key={current.studyItem.id}
                candidate={current.transformation}
                revealed={revealed}
                onCheck={(value) => {
                  setTypedResponse(value);
                  setRevealed(true);
                }}
              />
            ) : current.pitchAccent ? (
              <PitchAccentCard
                key={current.studyItem.id}
                candidate={current.pitchAccent}
                revealed={revealed}
                onCheck={(value) => {
                  setTypedResponse(value);
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
            ) : current.grammar ? (
              <GrammarComprehensionCard
                candidate={current.grammar}
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
  mnemonicVisible,
  onShowMnemonic,
}: {
  activityType: StudyActivityType;
  sentence: Sentence;
  vocabularyItem: VocabularyItem;
  surfaceForm: string;
  revealed: boolean;
  onReveal: () => void;
  mnemonicVisible: boolean;
  onShowMnemonic: () => void;
}) {
  const isCloze = activityType === 'cloze';
  const [before, target, after] = splitOnSurfaceForm(sentence.japanese, surfaceForm);
  return (
    <>
      <div className="jp jp-lg">
        {before}
        <mark>{isCloze && !revealed ? '_____' : target || surfaceForm}</mark>
        {after}
      </div>
      {isCloze && !revealed && sentence.translation ? (
        <div className="muted">{sentence.translation}</div>
      ) : null}
      {!revealed && vocabularyItem.notes ? (
        mnemonicVisible ? (
          <div className="muted">💡 {vocabularyItem.notes}</div>
        ) : (
          <button type="button" onClick={onShowMnemonic}>
            Show mnemonic
          </button>
        )
      ) : null}
      {!revealed ? (
        <button type="button" onClick={onReveal}>
          {isCloze ? 'Reveal word' : 'Reveal reading'}
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
 */
function ReadingProductionCard({
  sentence,
  vocabularyItem,
  surfaceForm,
  revealed,
  onCheck,
  mnemonicVisible,
  onShowMnemonic,
}: {
  sentence: Sentence;
  vocabularyItem: VocabularyItem;
  surfaceForm: string;
  revealed: boolean;
  onCheck: (typedReading: string) => void;
  mnemonicVisible: boolean;
  onShowMnemonic: () => void;
}) {
  const [value, setValue] = useState('');
  const [wasCorrect, setWasCorrect] = useState(false);
  const [before, target, after] = splitOnSurfaceForm(sentence.japanese, surfaceForm);

  return (
    <>
      <div className="jp jp-lg">
        {before}
        <mark>{target || surfaceForm}</mark>
        {after}
      </div>
      {!revealed && vocabularyItem.notes ? (
        mnemonicVisible ? (
          <div className="muted">💡 {vocabularyItem.notes}</div>
        ) : (
          <button type="button" onClick={onShowMnemonic}>
            Show mnemonic
          </button>
        )
      ) : null}
      {!revealed ? (
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            setWasCorrect(isReadingAnswerCorrect(value, vocabularyItem.reading));
            onCheck(value);
          }}
        >
          <label>
            Type the reading
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
 * Sentence transformation (Phase 7.9, sentence-transformations slice): the
 * "production ladder"'s second rung — instead of recalling the dictionary
 * reading, the learner has to produce a specific conjugated form (which
 * form varies per word, see pickTransformationTarget). Same typed-input
 * + check + reveal + self-rate shape as ReadingProductionCard, but checks
 * against the pre-computed target reading (candidate.target.reading) and
 * reveals both the conjugated expression and reading on top of the usual
 * meaning, since the conjugated kanji form is itself part of the answer a
 * learner would want to see, unlike reading_production where the dictionary
 * expression was already shown.
 */
function SentenceTransformationCard({
  candidate,
  revealed,
  onCheck,
}: {
  candidate: SentenceTransformationCandidate;
  revealed: boolean;
  onCheck: (typedReading: string) => void;
}) {
  const [value, setValue] = useState('');
  const [wasCorrect, setWasCorrect] = useState(false);
  const { vocabularyItem, sentence, surfaceForm, target, formLabel } = candidate;
  const [before, dictionaryForm, after] = splitOnSurfaceForm(sentence.japanese, surfaceForm);

  return (
    <>
      <div className="jp jp-lg">
        {before}
        <mark>{dictionaryForm || surfaceForm}</mark>
        {after}
      </div>
      <div className="muted">Conjugate to: {formLabel}</div>
      {!revealed ? (
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            setWasCorrect(isReadingAnswerCorrect(value, target.reading));
            onCheck(value);
          }}
        >
          <label>
            Type the conjugated reading
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
          <div className="jp">{target.expression}</div>
          <div className="jp">{target.reading}</div>
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
 * Pitch accent: multiple choice among the categories
 * (getPitchAccentReviewCandidates's own doc comment covers eligibility and
 * choice-set construction). Shows the reading up front, unlike
 * reading_retrieval/reading_production — this card tests *how* to say a
 * known reading, not recall of the reading itself. Auto-graded (the app
 * knows the right choice), same typed-response/self-rate funnel every
 * other selected-answer card uses — `onCheck` sets `typedResponse` to the
 * chosen label, which classifyReviewError compares against
 * `expectedAnswer` (candidate.correctLabel) the same way it already does
 * for reading_production/sentence_transformation/grammar_completion.
 * Deliberately does not feed the mnemonic-scaffolding effect (that
 * signal is tuned for reading/meaning recall fragility, not
 * pitch-accent-category recall — reusing it would show an unrelated
 * mnemonic on a card that tests neither).
 */
function PitchAccentCard({
  candidate,
  revealed,
  onCheck,
}: {
  candidate: PitchAccentReviewCandidate;
  revealed: boolean;
  onCheck: (chosenLabel: string) => void;
}) {
  const { vocabularyItem, sentence, surfaceForm, correctLabel, choices } = candidate;
  const [selected, setSelected] = useState<PitchAccentPattern | null>(null);
  const [before, target, after] = splitOnSurfaceForm(sentence.japanese, surfaceForm);

  return (
    <>
      <div className="jp jp-lg">
        {before}
        <mark>{target || surfaceForm}</mark>
        {after}
      </div>
      <div className="jp">{vocabularyItem.reading}</div>
      {!revealed ? (
        <>
          <div className="muted">Which pitch pattern?</div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {choices.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => {
                  setSelected(choice);
                  onCheck(choice);
                }}
              >
                {PITCH_ACCENT_PATTERN_LABELS[choice]}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="muted">{selected === correctLabel ? '✓ Correct' : '✗ Not quite'}</div>
          <div>{PITCH_ACCENT_PATTERN_LABELS[correctLabel]}</div>
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
 * playbackRate prop. Once text is revealed, it's rendered via
 * KaraokeSentenceText, which highlights words in sync with playback using
 * lazily-computed forced alignment — falls back to plain text on its own
 * when alignment isn't available, so no fallback branching is needed here.
 */
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

