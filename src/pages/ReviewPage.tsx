import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { KaraokeSentenceText } from '../components/KaraokeSentenceText';
import { LiveShadowWaveform } from '../components/LiveShadowWaveform';
import { MeasuredPitchContour } from '../components/MeasuredPitchContour';
import { NativeAudioButton } from '../components/NativeAudioButton';
import { PitchAccentDiagram } from '../components/PitchAccentDiagram';
import { PitchAccentNativeAudio } from '../components/PitchAccentNativeAudio';
import { PitchContrastExample } from '../components/PitchContrastExample';
import { WordPitchContour } from '../components/WordPitchContour';
import { PitchChoiceContour } from '../components/PitchChoiceContour';
import { PitchWordPhraseWarmup } from '../components/PitchWordPhraseWarmup';
import { RecordToggleButton } from '../components/RecordToggleButton';
import { SentenceAudioAdjuster } from '../components/SentenceAudioAdjuster';
import { SentencePitchAccentRow } from '../components/SentencePitchAccentRow';
import { SentencePitchAccentText } from '../components/SentencePitchAccentText';
import { SpeedControl } from '../components/SpeedControl';
import { ReadingHelpPanel } from '../components/ReadingHelpPanel';
import { VocabChips } from '../components/VocabChips';
import { createActiveTimer, pageIsActive } from '../lib/activeTimer';
import { buildCardReportDiagnostics } from '../lib/cardReportDiagnostics';
import { FuriganaText } from '../lib/furigana';
import { parseInlineReadings } from '../lib/parseInlineReadings';
import {
  countReviewsSince,
  deleteSentenceCascade,
  ensureStudyItem,
  ensureVocabularyStudyItem,
  getDb,
  logGlossDecision,
  countSentencesSeededSince,
  getDueStudyItems,
  getSentenceReviewHistory,
  getWeakWordRecallTarget,
  getPitchAccentDrillSentences,
  getReferencePitchTrack,
  loadSuspendedBookIndex,
  saveReferencePitchTrack,
  getTrackedGrammarSpansForSentences,
  getVocabularyOccurrenceCandidates,
  readSettings,
  recordReview,
  recordReviewTroubleTags,
  reportCardIssue,
  settleSessionStep,
  updatePlannerSessionStep,
  type PitchAccentDrillSentence,
  type SentenceReviewHistory,
  type TrackedGrammarSpan,
  type VocabularyOccurrenceCandidate,
  requestFreshTry,
} from '../db/repository';
import { useActiveSession } from '../hooks/useActiveSession';
import { distractorHistoryFromRecords, sampleMeaningQuestion } from '../lib/meaningChoices';
import { useNativeAudio } from '../hooks/useNativeAudio';
import { nativeAudioController } from '../lib/nativeAudio';
import { useSentenceAudioBlob } from '../hooks/useSentenceAudioBlob';
import { useShadowing } from '../hooks/useShadowing';
import { sessionStepTargetPath } from '../lib/sessionPlanner';
import type {
  AnalysisChunk,
  Book,
  ComprehensionCheck,
  MeaningChoiceRecord,
  ReviewAssistance,
  ReviewRating,
  ReviewTroubleTag,
  Sentence,
  SentenceAudio,
  SentenceVocabulary,
  StudyActivityType,
  StudyItem,
  VocabularyItem,
} from '../domain/types';
import {
  type ConjugationFormKey,
} from '../lib/conjugation';
import { buildReadingContextMap, type ReadingContext } from '../lib/readingContext';
import { AMBIGUITY_PRONE_ROLES } from '../lib/roleGuide';
import { sentenceIsSuspendedOnly } from '../lib/suspendedBooks';
import { startOfLocalDayIso } from '../lib/dailyPractice';
import {
  AUDIO_DESCRIPTOR_KEY,
  pickSentenceQuotaSubjects,
  pickAudioQuotaSubjects,
  quotaRemaining,
  SENTENCE_DESCRIPTOR_KEY,
} from '../lib/newWordQuota';
import { segmentIntoMorae } from '../lib/mora';
import type { PitchAnalysisPayload } from '../lib/pitch';
import { explainPitchAccent } from '../lib/pitchAccentRules';
import { resolveInflectedPitchAccent } from '../lib/pitchAccentShift';
import { loadOrComputeReferencePitch } from '../lib/referencePitchCache';
import {
  expectedPitchShape,
  pitchPatternLabel,
  type PitchAccentPattern,
} from '../lib/pitchAccentShape';
import {
  analyzePitchAccentDrillRecording,
  type PitchAccentDrillAnalysisState,
} from '../lib/pitchAccentDrillAnalysis';
import { gradeDictation, typedAsKana, type DictationGrade } from '../lib/dictationAnswer';
import {
  buildCheckPuzzle,
  buildTileDictation,
  chooseDictationTile,
  DICTATION_TILE_TYPES,
  dictationTileIndex,
  dictationTileKey,
  EAR_TILES_ACTIVITY,
  earTilesKnownWell,
  type TileDictation,
} from '../lib/earTiles';
import { createId } from '../lib/ids';
import { REVIEW_TROUBLE_TAGS } from '../lib/reviewTroubleTags';
import { ReviewStageIcon } from '../components/ReviewStageIcon';
import { EarTilesCheck } from '../components/EarTilesCheck';
import { isReadingAnswerCorrect, surfaceReadingFromInline } from '../lib/readingAnswer';
import { MAX_RECORDING_DURATION_MS, PLAYBACK_SPEEDS, type TimeRangeMs } from '../lib/recording';
import { splitOnSurfaceForm } from '../lib/surfaceForm';

/**
 * Sentence-subject review: one activity type, `reading_in_context`. Shows
 * the Japanese sentence framed by its reading-order neighbours (preceding
 * sentences untranslated above, the following sentence's translation folded
 * into the reveal — see ReadingInContextCard / buildReadingContextMap),
 * then reveals EN + vocab for a self-rating. Falls back to the isolated
 * layout when no passage is available (inbox-only sentence, or a
 * book-scoped queue that can't see the neighbours).
 *
 * History: this was two types — a plain isolated `comprehension` and
 * `reading_in_context`. `comprehension` was retired 2026-09-08 (user:
 * "always better to learn in context if possible"); its existing study
 * items were migrated to `reading_in_context`
 * (scripts/migrate-comprehension-to-reading-in-context.ts).
 */
const SENTENCE_ACTIVITY_TYPES: StudyActivityType[] = ['reading_in_context'];

/**
 * Audio comprehension (Phase 7.4, docs/STATUS.md) — sentence-subject, like
 * `comprehension`/`reading_in_context`, but only eligible for sentences
 * that have at least one `SentenceAudio` row; the Japanese text stays
 * hidden until reveal, audio plays first. Two tile-based cards ride on the same
 * candidates (src/lib/earTiles.ts): `ear_tiles` taps the tiles you hear in
 * order (the walkthrough's old warm-up, now its own card), and
 * `dictation_tile:N` types just tile N of the sentence, replacing the
 * whole-sentence dictation. A dictation tile only seeds once the sentence's
 * `ear_tiles` card is known well (earTilesKnownWell) — the easier card is the
 * stepping stone.
 */
const AUDIO_ACTIVITY_TYPES: StudyActivityType[] = [
  'listening',
  EAR_TILES_ACTIVITY,
  ...DICTATION_TILE_TYPES,
];

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
 * Pitch-accent *production* review (docs/ROADMAP.md "Pull the pitch-accent
 * production drill into a review card…", shipped 2026-09-24). subjectType
 * `sentence` (unlike perception `pitch_accent`, which is `vocabularyItem`) —
 * the learner records the whole sentence, scored against every target
 * word's dictionary shape at once, so the natural subject is the sentence.
 * Eligibility (`getPitchAccentDrillSentences`, `src/db/repository.ts`) is
 * the *complement* of perception `pitch_accent`'s: confirmed vocabulary
 * with dictionary `pitchAccentPositions` and **no** reference recording —
 * reaches the majority of the corpus that the reference-audio-gated
 * perception card can't. Self-rated, like every other card in this app;
 * the learner's own measured per-mora H/L (from
 * `analyzePitchAccentDrillRecording`, `src/lib/pitchAccentDrillAnalysis.ts`
 * — the same pipeline `PitchAccentDrillPage`'s free-practice loop uses) is
 * shown as feedback before rating, never used to auto-pick a rating — see
 * that module's doc comment and PitchAccentCard's sibling comment above for
 * why this app never auto-derives a rating from an objective result.
 * Sentence-mode only for v1 — `PitchAccentDrillPage`'s single-word mode
 * isn't wired into review scheduling.
 */
const PITCH_ACCENT_PRODUCTION_ACTIVITY_TYPES: StudyActivityType[] = ['pitch_accent_production'];

const ACTIVITY_LABELS: Record<string, string> = {
  comprehension: 'Comprehension',
  reading_in_context: 'Reading in context',
  reading_retrieval: 'Reading retrieval',
  cloze: 'Cloze',
  reading_production: 'Reading production',
  listening: 'Listening',
  dictation: 'Dictation',
  ear_tiles: 'Ear tiles',
  word_listening: 'Word listening',
  contrastive: 'Contrastive pair',
  sentence_transformation: 'Conjugation in context',
  pitch_accent: 'Pitch accent',
  pitch_accent_production: 'Pitch accent (say it)',
  grammar_completion: 'Grammar completion',
  grammar_recognition: 'Grammar recognition',
};

interface PitchAccentReviewCandidate {
  vocabularyItem: VocabularyItem;
  sentence: Sentence;
  surfaceForm: string;
  /** The sentence's first reference recording — required (see getPitchAccentReviewCandidates); powers the card's "loop the native word" control. */
  audio: SentenceAudio;
  /** The link this candidate came from — carries any manual word-audio range for the loop control's "Adjust" editor. */
  link?: SentenceVocabulary;
  /**
   * Reading whose morae back this card — the dictionary reading for a
   * citation-form occurrence, or the conjugated reading for an inflected
   * one (see getPitchAccentReviewCandidates). Always what the native clip
   * actually says, never assumed to be vocabularyItem.reading.
   */
  reading: string;
  /** Mora kana of `reading` — the drop-position choices and the ✓/✗ both key off these. */
  morae: string[];
  /** Downstep (in `reading`'s own morae) clamped into [0, morae.length]: 0 = heiban/no drop, n = drop right after mora n (n === morae.length is odaka). */
  correctPosition: number;
  /** Category name (平板/頭高/中高/尾高), shown on the reveal only — the buttons ask for a drop position, not this. */
  correctLabel: PitchAccentPattern;
  /** Which conjugation this occurrence realizes, when inflected (resolveInflectedPitchAccent's own field) — lets the reveal's rule-note copy call out the -masu family's fixed accent instead of the citation form's own class. */
  conjugationFormKey?: ConjugationFormKey;
}

/**
 * True when the first occurrence of `surfaceForm` in `japanese` is
 * immediately followed by a hiragana mora — a grammatical particle, copula,
 * or auxiliary in the same accent phrase, i.e. something for an odaka /
 * heiban word's downstep to actually land on. Punctuation, a trailing
 * pause, the end of the sentence, or the next content word's kanji all read
 * as "nothing follows."
 */
function hasFollowingVoicedMora(japanese: string, surfaceForm: string): boolean {
  const [, target, after] = splitOnSurfaceForm(japanese, surfaceForm);
  if (!target) return false;
  return /^[ぁ-ゟ]/.test(after);
}

/**
 * Below this semitone separation between a native clip's dictionary-expected
 * high and low morae (`SentenceVocabulary.pitchCueSeparationSemitones`,
 * `scripts/backfill-pitch-cue-strength.ts`), the clip is treated the same as
 * a missing recording — the card can't teach a contrast the ear can't hear.
 * Matches `scripts/audit-pitch-accent-clips.ts`'s own WEAK_SEPARATION_ST, so
 * a clip flagged "weak" there is exactly the one gated here. Undefined
 * (never measured) is "unknown," not "weak," and is never gated on.
 */
const PITCH_CUE_WEAK_SEPARATION_ST = 1.5;

/**
 * Pure filter over already-fetched per-occurrence vocabulary candidates (no
 * DB access needed) — a word is a candidate only if it has dictionary
 * pitch-accent data and at least one occurrence with a native reference
 * recording that survives the checks below.
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
 * That only helps when the clip actually *has* a following mora for the
 * downstep to land on. When the accent sits on the word's edge — heiban
 * (drop 0) or odaka (drop === mora count) — and this occurrence is
 * phrase-final (nothing voiced follows before punctuation / a pause / the
 * next content word), the two contours are identical by ear, so the card is
 * skipped the same way a missing recording skips it (user request,
 * 2026-09-07; cf. the "gate cards that can't populate their scaffolding"
 * stance). An internal drop (atamadaka / nakadaka) is audible on the word
 * alone and needs no following particle.
 *
 * An occurrence in citation form is always preferred: the choices and the
 * ✓/✗ key off the dictionary reading's morae and downstep directly. An
 * inflected occurrence (読まない for 読む) is only accepted when
 * pitchAccentShift.ts's predictInflectedPitchAccentPosition can confidently
 * place the downstep in the *conjugated* reading's own morae — currently a
 * narrow set of godan forms only, ported from Wiktionary's audited
 * Module:ja-acc-table rather than assumed (see that module's doc comment
 * for what's covered and why ichidan/i-adjectives/te-form aren't) —
 * otherwise the looped audio's mora count and accent would disagree with
 * the "correct" answer (the ござる/ありがとうございます bug this filter was
 * first written to fix). One card per word: among all its occurrences,
 * prefer the first citation-form one
 * with audio; only fall back to an inflected one when no citation-form
 * occurrence works. The ambient SentencePitchAccentRow shares this same
 * resolution logic (resolveInflectedPitchAccent in pitchAccentShift.ts)
 * for its own per-word contours, including under `sentence_transformation`.
 */
function buildPitchAccentCandidate(
  occurrence: VocabularyOccurrenceCandidate,
  audio: SentenceAudio,
): { candidate: PitchAccentReviewCandidate; isCitationForm: boolean } | null {
  const { vocabularyItem, sentence, surfaceForm, link } = occurrence;
  const resolved = resolveInflectedPitchAccent({ vocabularyItem, sentence, surfaceForm });
  if (!resolved) return null;
  const { reading, isCitationForm, formKey: conjugationFormKey } = resolved;
  // The stored occurrence surfaceForm can be a truncated stem (言い for
  // 言います) — use the resolver's own full conjugated surface for anything
  // that isolates/highlights the word in the sentence, so the native-audio
  // loop and target underline cover the same span the tested reading/morae
  // do (see ResolvedPitchAccent.surfaceForm doc comment).
  const targetSurfaceForm = resolved.surfaceForm;

  const morae = segmentIntoMorae(reading).map((unit) => unit.text);
  if (morae.length === 0) return null;
  const correctPosition = Math.max(0, Math.min(resolved.position, morae.length));
  // Edge accent (heiban / odaka) is only audible on what follows the word;
  // skip the occurrence when nothing does (see doc comment).
  const isEdgeAccent = correctPosition === 0 || correctPosition === morae.length;
  if (isEdgeAccent && !hasFollowingVoicedMora(sentence.japanese, targetSurfaceForm)) return null;
  // A citation-form clip whose measured cue is known to be weak/absent can't
  // teach the contrast it's testing — same stance as the edge-accent check
  // above (see PITCH_CUE_WEAK_SEPARATION_ST doc comment).
  const cueSeparation = link?.pitchCueSeparationSemitones;
  if (cueSeparation !== undefined && cueSeparation < PITCH_CUE_WEAK_SEPARATION_ST) return null;

  return {
    isCitationForm,
    candidate: {
      vocabularyItem,
      sentence,
      surfaceForm: targetSurfaceForm,
      audio,
      link,
      reading,
      morae,
      correctPosition,
      correctLabel: pitchPatternLabel(correctPosition, morae.length),
      conjugationFormKey,
    },
  };
}

/**
 * Ranks two citation-form candidates for the same word by how strong their
 * clip's measured cue is — a known-strong clip beats an as-yet-unmeasured
 * one, which in turn beats nothing (docs/ROADMAP.md "Gate/rank pitch_accent
 * cards by measured cue strength"). Weak clips never reach here; they're
 * already excluded by buildPitchAccentCandidate's own gate.
 */
function isStrongerPitchCandidate(
  candidate: { candidate: PitchAccentReviewCandidate; isCitationForm: boolean },
  than: { candidate: PitchAccentReviewCandidate; isCitationForm: boolean },
): boolean {
  if (candidate.isCitationForm !== than.isCitationForm) return candidate.isCitationForm;
  const a = candidate.candidate.link?.pitchCueSeparationSemitones ?? -Infinity;
  const b = than.candidate.link?.pitchCueSeparationSemitones ?? -Infinity;
  return a > b;
}

function getPitchAccentReviewCandidates(
  occurrences: VocabularyOccurrenceCandidate[],
  audioBySentenceId: Map<string, SentenceAudio>,
): PitchAccentReviewCandidate[] {
  const bestByItemId = new Map<
    string,
    { candidate: PitchAccentReviewCandidate; isCitationForm: boolean }
  >();
  for (const occurrence of occurrences) {
    const existing = bestByItemId.get(occurrence.vocabularyItem.id);
    // Once we have a citation-form match with a known-strong cue, no later
    // occurrence (citation or inflected) can beat it — skip the rebuild.
    if (existing?.isCitationForm && (existing.candidate.link?.pitchCueSeparationSemitones ?? -Infinity) >= PITCH_CUE_WEAK_SEPARATION_ST) {
      continue;
    }
    const audio = audioBySentenceId.get(occurrence.sentence.id);
    if (!audio) continue;
    const result = buildPitchAccentCandidate(occurrence, audio);
    if (!result) continue;
    if (existing && !isStrongerPitchCandidate(result, existing)) continue;
    bestByItemId.set(occurrence.vocabularyItem.id, result);
  }
  return [...bestByItemId.values()].map((entry) => entry.candidate);
}

const RATINGS: { value: ReviewRating; label: string }[] = [
  { value: 'again', label: 'Again' },
  { value: 'hard', label: 'Hard' },
  { value: 'good', label: 'Good' },
  { value: 'easy', label: 'Easy' },
];

interface QueueCard {
  studyItem: StudyItem;
  sentence: Sentence;
  /** Set only for audio-comprehension cards (listening). */
  audio?: SentenceAudio;
  /** Set only for pitch-accent cards. */
  pitchAccent?: PitchAccentReviewCandidate;
  /** Set only for pitch-accent *production* cards. */
  pitchAccentProduction?: PitchAccentDrillSentence;
  /** Set for `reading_in_context` cards — the surrounding passage. */
  readingContext?: ReadingContext;
  /** Set for `reading_in_context`/`listening` cards whose sentence has an authored comprehension check. */
  comprehensionCheck?: ComprehensionCheck;
  /** Set for `reading_in_context` cards whose sentence has a saved structural analysis. */
  analysisChunks?: AnalysisChunk[];
}

/** `${subjectType}:${subjectId}` — same key the sibling-bury filter uses. */
function queueCardSubjectKey(card: QueueCard): string {
  return `${card.studyItem.subjectType}:${card.studyItem.subjectId}`;
}

/**
 * A pitch-accent card keys on the vocabulary item, so it also carries a
 * word-in-sentence key: two cards on the same word in the same sentence are
 * siblings even when their subject keys differ.
 */
function queueCardVocabularySiblingKey(card: QueueCard): string | undefined {
  const vocabularyItemId = card.pitchAccent?.vocabularyItem.id;
  return vocabularyItemId ? `vocab:${card.sentence.id}:${vocabularyItemId}` : undefined;
}

function queueCardSiblingKeys(card: QueueCard): string[] {
  const vocabularyKey = queueCardVocabularySiblingKey(card);
  return vocabularyKey ? [queueCardSubjectKey(card), vocabularyKey] : [queueCardSubjectKey(card)];
}

/**
 * Reorders a list so two items sharing a sibling key are never adjacent
 * unless every remaining item shares one of the keys just emitted. Greedy:
 * always take the earliest item whose sibling keys don't overlap the
 * previous item's; fall back to plain order only when it can't.
 */
function spaceOutBySiblingKeys<T>(items: T[], siblingKeys: (item: T) => string[]): T[] {
  const remaining = [...items];
  const spaced: T[] = [];
  let lastKeys: string[] = [];
  while (remaining.length > 0) {
    let index = remaining.findIndex(
      (item) => !siblingKeys(item).some((key) => lastKeys.includes(key)),
    );
    if (index === -1) index = 0;
    const [item] = remaining.splice(index, 1);
    spaced.push(item!);
    lastKeys = siblingKeys(item!);
  }
  return spaced;
}

/**
 * Reorders a due queue so two cards on the same subject (or same word in the
 * same sentence, across descriptors — queueCardSiblingKeys) are never
 * adjacent unless every remaining card shares that subject (user request
 * 2026-09-04, broadened 2026-09-17). The sibling-bury filter above only
 * holds back `review`/`relearning` siblings; a word whose reading_retrieval /
 * cloze / reading_production are all still `learning` (e.g. rated "again"
 * every sitting for days) keeps all three — and due-sorted they land
 * adjacent, so revealing the first turns the next into a short-term echo
 * test.
 */
export function spaceOutSiblingCards(cards: QueueCard[]): QueueCard[] {
  return spaceOutBySiblingKeys(cards, queueCardSiblingKeys);
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
   * Per activity type: returns false to withhold just that (candidate,
   * activityType) pair from both the due queue and seeding. Used by the
   * listening descriptor's tile cards.
   */
  activityIsReady?: (candidate: unknown, activityType: StudyActivityType) => boolean;
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
  activityIsReady?: (candidate: C, activityType: StudyActivityType) => boolean;
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
  /** Authored comprehension-check options per in-scope sentence, for `reading_in_context`. */
  comprehensionCheckBySentenceId: Map<string, ComprehensionCheck>;
  /** Saved structural-analysis chunks per in-scope sentence, for `reading_in_context`'s later-review structure check. */
  chunksBySentenceId: Map<string, AnalysisChunk[]>;
  /**
   * Sentences the learner has been introduced to (gloss walkthrough done,
   * started/completed in a book, or already carrying a sentence card).
   */
  introducedSentenceIds: Set<string>;
  audioCandidates: AudioCandidate[];
  existingAudioItems: StudyItem[];
  pitchAccentCandidates: PitchAccentReviewCandidate[];
  existingPitchAccentItems: StudyItem[];
  pitchAccentProductionCandidates: PitchAccentDrillSentence[];
  existingPitchAccentProductionItems: StudyItem[];
}

/** Descriptor keys whose cards are sentence-subject cards (reading_in_context; listening/Ear Tiles/dictation). */
const SENTENCE_CARD_DESCRIPTOR_KEYS = new Set(['sentence', 'listening']);

function buildActivityDescriptors(scope: ReviewScope): ActivityDescriptor[] {
  return [
    defineActivityDescriptor<Sentence>({
      key: 'sentence',
      activityTypes: SENTENCE_ACTIVITY_TYPES,
      candidates: scope.sentences.filter((sentence) => scope.introducedSentenceIds.has(sentence.id)),
      existingItems: scope.existingSentenceItems,
      subjectId: (sentence) => sentence.id,
      buildCard: (studyItem, sentence) => ({
        studyItem,
        sentence,
        readingContext: scope.readingContextBySentenceId.get(sentence.id),
        comprehensionCheck: scope.comprehensionCheckBySentenceId.get(sentence.id),
        analysisChunks: scope.chunksBySentenceId.get(sentence.id),
      }),
      ensure: (sentence, activityType) => ensureStudyItem('sentence', sentence.id, activityType),
    }),
    defineActivityDescriptor<AudioCandidate>({
      key: 'listening',
      activityTypes: AUDIO_ACTIVITY_TYPES,
      candidates: scope.audioCandidates.filter((candidate) =>
        scope.introducedSentenceIds.has(candidate.sentence.id),
      ),
      existingItems: scope.existingAudioItems,
      subjectId: (candidate) => candidate.sentence.id,
      buildCard: (studyItem, candidate) => ({
        studyItem,
        sentence: candidate.sentence,
        audio: candidate.audio,
        comprehensionCheck: scope.comprehensionCheckBySentenceId.get(candidate.sentence.id),
      }),
      ensure: (candidate, activityType) =>
        ensureStudyItem('sentence', candidate.sentence.id, activityType),
      activityIsReady: (candidate, activityType) => {
        if (activityType === 'listening') return true;
        // Both tile cards need a sentence that splits cleanly into check-sized tiles.
        const tileCount = buildCheckPuzzle(candidate.sentence, candidate.sentence.id)?.answer.length ?? 0;
        if (activityType === EAR_TILES_ACTIVITY) return tileCount > 0;
        const tile = dictationTileIndex(activityType);
        // Dictation tiles are the raw split (never merged), so check them directly.
        if (tile === null || buildTileDictation(candidate.sentence, tile) === null) return false;
        const sentenceId = candidate.sentence.id;
        const ownDictationTiles = scope.existingAudioItems
          .filter((item) => item.subjectId === sentenceId)
          .map((item) => dictationTileIndex(item.activityType))
          .filter((index): index is number => index !== null);
        if (
          !scope.existingAudioItems.some(
            (item) =>
              item.subjectId === sentenceId &&
              item.activityType === EAR_TILES_ACTIVITY &&
              earTilesKnownWell(item.fsrsState),
          )
        ) {
          return false;
        }
        // A tile that already has a card keeps surfacing, so earlier seeding is never stranded.
        if (ownDictationTiles.includes(tile)) return true;
        // One new dictation tile per sentence, and never a phrase another sentence already dictates.
        if (ownDictationTiles.length > 0) return false;
        const claimedKeys = new Set<string>();
        const sentenceById = new Map(scope.audioCandidates.map((c) => [c.sentence.id, c.sentence]));
        for (const item of scope.existingAudioItems) {
          const index = dictationTileIndex(item.activityType);
          if (index === null || item.subjectId === sentenceId) continue;
          const other = sentenceById.get(item.subjectId);
          const text = other ? buildTileDictation(other, index)?.text : undefined;
          if (text) claimedKeys.add(dictationTileKey(text));
        }
        return chooseDictationTile(candidate.sentence, claimedKeys) === tile;
      },
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
    defineActivityDescriptor<PitchAccentDrillSentence>({
      key: 'pitchAccentProduction',
      activityTypes: PITCH_ACCENT_PRODUCTION_ACTIVITY_TYPES,
      candidates: scope.pitchAccentProductionCandidates,
      existingItems: scope.existingPitchAccentProductionItems,
      subjectId: (candidate) => candidate.sentence.id,
      buildCard: (studyItem, candidate) => ({
        studyItem,
        sentence: candidate.sentence,
        pitchAccentProduction: candidate,
      }),
      ensure: (candidate, activityType) =>
        ensureStudyItem('sentence', candidate.sentence.id, activityType),
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

/** The pitch-accent candidate carries `.vocabularyItem` and `.sentence`; other candidates have no single word to key on. */
function pendingSeedVocabularySiblingKey(candidate: unknown): string | undefined {
  const { vocabularyItem, sentence } = candidate as {
    vocabularyItem?: { id: string };
    sentence?: { id: string };
  };
  return vocabularyItem && sentence ? `vocab:${sentence.id}:${vocabularyItem.id}` : undefined;
}

/** The sentence a pending seed belongs to: the 'sentence' descriptor's candidate is the sentence itself, the others nest it. */
function pendingSeedSentenceId(seed: PendingSeed): string | undefined {
  if (seed.descriptorKey === 'sentence') {
    return (seed.candidate as { id?: string }).id;
  }
  return (seed.candidate as { sentence?: { id: string } }).sentence?.id;
}

/**
 * Reorders pending-seed batches (one batch = one descriptorKey+subjectId's
 * activity types, always introduced together) so two batches on the same
 * word in the same sentence aren't the two consecutive "new card" reveals —
 * e.g. the `vocabulary` descriptor's reading cards and the `wordListening`
 * descriptor's occurrence card for the same just-confirmed word commonly
 * sit at the same round-robin index (both candidate lists are in the same
 * sentence order) and would otherwise land back to back (user report
 * 2026-09-17). Batches with no resolvable vocabulary item (sentence/
 * listening/grammar/confusion) are left unconstrained.
 */
function spaceOutPendingSeedBatches(seeds: PendingSeed[]): PendingSeed[] {
  const batchOrder: string[] = [];
  const batches = new Map<string, PendingSeed[]>();
  for (const seed of seeds) {
    const batchKey = `${seed.descriptorKey}:${seed.subjectId}`;
    let batch = batches.get(batchKey);
    if (!batch) {
      batch = [];
      batches.set(batchKey, batch);
      batchOrder.push(batchKey);
    }
    batch.push(seed);
  }
  const spacedBatchOrder = spaceOutBySiblingKeys(batchOrder, (batchKey) => {
    const vocabularyKey = pendingSeedVocabularySiblingKey(batches.get(batchKey)![0]!.candidate);
    return vocabularyKey ? [vocabularyKey] : [];
  });
  return spacedBatchOrder.flatMap((batchKey) => batches.get(batchKey)!);
}

export function ReviewPage() {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const activeSession = useActiveSession();
  // "Deep dive" (docs/ROADMAP.md "Opt-in single-sentence deep dive") — an
  // explicit focus session on one lagging sentence's remaining mastery
  // rungs, reached from SentenceDeepDivePage. Narrows the whole scope below
  // to that one sentence and pulls its not-due cards in anyway (see
  // `ignoreDue` on getDueStudyItems) — a deliberate, opt-in bypass of normal
  // FSRS pacing, not a change to the regular queue's behavior.
  const [searchParams] = useSearchParams();
  const deepDiveSentenceId = searchParams.get('sentenceId') || undefined;
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
  // Reaching this page any way other than SessionRunnerPage's "Go" — the top
  // nav's "Review" link, SessionBar's "Resume" — leaves the planner's review
  // step `pending`, so it never gets a `startedAt`. Without that anchor
  // `countReviewsSince` can't run, and "Reviews this step" (plus the
  // target-count auto-advance below) sit frozen at 0 no matter how many cards
  // you grade. Activate it on arrival, exactly as "Go" would.
  useEffect(() => {
    if (!activeSession || !reviewStep || reviewStep.status !== 'pending') return;
    void updatePlannerSessionStep(activeSession.session.id, reviewStep.id, {
      status: 'active',
    });
  }, [activeSession?.session.id, reviewStep?.id, reviewStep?.status]);
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
  /** Active time on the current card (time hidden or without window focus excluded); recorded as `Review.elapsedMs`. */
  const cardTimerRef = useRef(createActiveTimer(typeof document === 'undefined' || pageIsActive()));
  /**
   * The reading `reading_production`'s Check step actually graded the typed
   * answer against — the dictionary reading, or the in-context inflected
   * reading when that's what the learner matched. Recorded as
   * `Review.expectedAnswer` so `classifyReviewError` reaches the same ✓/✗
   * verdict the card showed (otherwise an accepted inflected reading would
   * still be logged as `incorrect_reading`).
   */
  const [typedResponseExpected, setTypedResponseExpected] = useState<string | null>(null);
  /** `reading_in_context`/`listening`'s comprehension-check pick, when the sentence has one; recorded as supplementary Review evidence on rate. */
  const [comprehensionCheckAnswer, setComprehensionCheckAnswer] = useState<
    { correct: boolean; chosenIndex: number; meaningChoice?: MeaningChoiceRecord } | null
  >(null);
  /** `reading_in_context`'s "Missed reading" taps for this card; recorded on rate, never affects the rating. */
  const [missedReadings, setMissedReadings] = useState<string[]>([]);
  /** Optional "what was hard?" chips; queue a follow-up after the review, never affect the rating. */
  const [troubleTags, setTroubleTags] = useState<ReviewTroubleTag[]>([]);
  /** `pitch_accent_production`'s completed take, once scored; recorded as supplementary Review evidence on rate. */
  const [pitchProductionEvidence, setPitchProductionEvidence] = useState<
    { measuredCount: number; mismatchCount: number } | null
  >(null);
  /** "Report issue" — an inline text box, not window.prompt (silently no-ops on installed iOS Safari PWAs). */
  const [reportingIssue, setReportingIssue] = useState(false);
  const [issueNote, setIssueNote] = useState('');
  const [submittingIssue, setSubmittingIssue] = useState(false);
  const [issueReported, setIssueReported] = useState(false);
  const [freshTryStatus, setFreshTryStatus] = useState<'queued' | 'not_walked' | null>(null);
  /** "Delete sentence" — one confirm step, no window.prompt (see reportingIssue above). */
  const [confirmDeleteSentence, setConfirmDeleteSentence] = useState(false);
  const [deletingSentence, setDeletingSentence] = useState(false);
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
    if (deepDiveSentenceId) {
      const sentence = await db.sentences.get(deepDiveSentenceId);
      sentences = sentence ? [sentence] : [];
    } else if (bookId) {
      const memberships = await db.bookSentences
        .where('bookId')
        .equals(bookId)
        .sortBy('position');
      // Session review steps route here for an *active* book, so a chapter the
      // learner shelved inside it must still be held back. A suspended book's
      // own review stays exempt (deliberate open).
      const shelvedChapterIds = book?.suspendedAt
        ? new Set<string>()
        : new Set(
            (book?.chapters ?? [])
              .filter((chapter) => chapter.suspendedAt)
              .map((chapter) => chapter.id),
          );
      const found = await db.sentences.bulkGet(
        memberships
          .filter((item) => !item.chapterId || !shelvedChapterIds.has(item.chapterId))
          .map((item) => item.sentenceId),
      );
      sentences = found.filter((item): item is Sentence => Boolean(item));
    } else {
      sentences = await db.sentences.toArray();
      sentences.sort(
        (a, b) => a.firstOccurrenceIndex - b.firstOccurrenceIndex,
      );
      // Hold back sentences (and, downstream, the words) that the learner only
      // meets in suspended books — the global queue shouldn't keep drilling a
      // book they've shelved. Words shared with an active book still surface via
      // that book's sentences. The book-scoped path (`bookId` set) is exempt:
      // opening a suspended book's own review is deliberate.
      const suspendedIndex = await loadSuspendedBookIndex();
      if (suspendedIndex) {
        sentences = sentences.filter(
          (sentence) => !sentenceIsSuspendedOnly(sentence.id, suspendedIndex),
        );
      }
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

    const occurrenceCandidates = await getVocabularyOccurrenceCandidates(sentenceIds);

    // "Pause pitch accent" (settings.pitchAccentPaused, 2026-09-28 user
    // decision to let shadowing carry pitch accent for now) withholds both
    // the pitch_accent and pitch_accent_production candidate lists entirely
    // — an empty candidates list makes getDueStudyItems' subjectIds filter
    // match nothing, so existing due items are withheld too, not just new
    // seeding.
    const pitchAccentCandidates = settings?.pitchAccentPaused
      ? []
      : getPitchAccentReviewCandidates(occurrenceCandidates, audioBySentenceId);
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

    // Pitch-accent *production* (docs/ROADMAP.md, shipped 2026-09-24):
    // `getPitchAccentDrillSentences` computes over the whole corpus (no
    // bookId param, same as PitchAccentDrillPage) — filtered to this
    // scope's sentences so a book-scoped queue only offers its own. Quiet
    // mode withholds it entirely (recording required), same reasoning as
    // the session planner's shadowCandidates/pitch_accent_production
    // handling (src/db/repository.ts#getSessionPlannerInput) — this query
    // depends on settings.quietMode (see the deps array below) so toggling
    // it recomputes the queue live. `pitchAccentPaused` withholds it too,
    // same as the perception card above.
    const pitchAccentProductionCandidates =
      settings?.quietMode || settings?.pitchAccentPaused
        ? []
        : (await getPitchAccentDrillSentences()).filter((candidate) =>
            sentenceIdSet.has(candidate.sentence.id),
          );
    const existingPitchAccentProductionItems = (
      await db.studyItems
        .where('activityType')
        .anyOf(PITCH_ACCENT_PRODUCTION_ACTIVITY_TYPES)
        .toArray()
    ).filter(
      (item) =>
        item.subjectType === 'sentence' &&
        sentenceIdSet.has(item.subjectId),
    );

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

    const analysesForScope = await db.analyses.bulkGet(sentenceIds);
    const comprehensionCheckBySentenceId = new Map<string, ComprehensionCheck>();
    const chunksBySentenceId = new Map<string, AnalysisChunk[]>();
    analysesForScope.forEach((analysis, index) => {
      if (analysis?.comprehensionCheck) {
        comprehensionCheckBySentenceId.set(sentenceIds[index]!, analysis.comprehensionCheck);
      }
      if (analysis?.chunks.length) {
        chunksBySentenceId.set(sentenceIds[index]!, analysis.chunks);
      }
    });

    const walked = (await db.sentenceLearningEvents.toArray())
      .filter((event) => event.action === 'walkthrough_completed')
      .map((event) => event.sentenceId);
    const introducedSentenceIds = new Set([
      ...walked,
      ...contextBookSentences
        .filter((membership) => membership.status !== 'unstarted')
        .map((membership) => membership.sentenceId),
      ...existingSentenceItems.map((item) => item.subjectId),
    ]);

    return {
      book,
      sentences,
      existingSentenceItems,
      readingContextBySentenceId,
      comprehensionCheckBySentenceId,
      chunksBySentenceId,
      introducedSentenceIds,
      audioCandidates,
      existingAudioItems,
      pitchAccentCandidates,
      existingPitchAccentItems,
      pitchAccentProductionCandidates,
      existingPitchAccentProductionItems,
    };
  }, [
    bookId,
    deepDiveSentenceId,
    settings?.quietMode,
    settings?.pitchAccentPaused,
  ]);

  const sentenceCardsPaused = settings?.sentenceCardsPaused ?? false;
  const descriptors = useMemo(
    () =>
      scope
        ? buildActivityDescriptors(scope).filter(
            // "Pause sentence cards": the reader's Read check replaces the sentence-subject cards.
            (descriptor) => !(sentenceCardsPaused && SENTENCE_CARD_DESCRIPTOR_KEYS.has(descriptor.key)),
          )
        : [],
    [scope, sentenceCardsPaused],
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
      const dueByDescriptor = await Promise.all(
        descriptors.map((descriptor) =>
          getDueStudyItems(descriptor.activityTypes, {
            subjectIds: descriptor.candidates.map(descriptor.subjectId),
            graduationMinScheduledDays: settings.graduationMinScheduledDays,
            ignoreDue: Boolean(deepDiveSentenceId),
          }),
        ),
      );

      // A (candidate, activityType) pair its descriptor says isn't ready yet is kept out of
      // both the due queue and the pending-seed pool.
      const isGatedOut = (
        descriptor: ActivityDescriptor,
        candidate: unknown,
        activityType: StudyActivityType,
      ): boolean => Boolean(descriptor.activityIsReady && !descriptor.activityIsReady(candidate, activityType));

      const due: QueueCard[] = [];
      descriptors.forEach((descriptor, index) => {
        const byId = new Map(
          descriptor.candidates.map((candidate) => [descriptor.subjectId(candidate), candidate]),
        );
        for (const studyItem of dueByDescriptor[index]!) {
          const candidate = byId.get(studyItem.subjectId);
          if (candidate && !isGatedOut(descriptor, candidate, studyItem.activityType)) {
            due.push(descriptor.buildCard(studyItem, candidate));
          }
        }
      });
      due.sort((a, b) => a.studyItem.fsrsState.due.localeCompare(b.studyItem.fsrsState.due));

      // Bury siblings for the session (Anki's default behaviour): several cards on
      // one subject, graded alike, converge on near-identical due timestamps, so the
      // first card's reveal would turn the rest into a short-term echo test. Once a
      // subject has a card in the queue, its other *due* cards wait for the next
      // session; they stay due. Only `review`/`relearning` items are buried: `new`
      // and `learning` cards are first-exposure scaffolding, seeded as a batch below.
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
      // Any siblings that survived the bury filter (still `new`/`learning`)
      // get spread apart so they aren't shown back to back.
      const spaced = spaceOutSiblingCards(deduped);

      // Any (subject, activityType) pair with no study_item yet needs seeding,
      // tracked per pair so a subject left with only some activity types seeded
      // still gets the rest. Built per descriptor, then interleaved round-robin
      // so a mix of card types shows up early instead of one descriptor's whole
      // backlog first. Batching by (descriptorKey, subjectId) below filters the
      // whole pool, so a candidate's activity types still seed together.
      const pendingSeedsByDescriptor: PendingSeed[][] = descriptors.map((descriptor) => {
        const existingKeys = new Set(
          descriptor.existingItems.map(
            (item) => `${item.subjectId}:${item.activityType}`,
          ),
        );
        const seeds: PendingSeed[] = [];
        for (const candidate of descriptor.candidates) {
          const subjectId = descriptor.subjectId(candidate);
          for (const activityType of descriptor.activityTypes) {
            if (isGatedOut(descriptor, candidate, activityType)) continue;
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
      // Interleaving above still leaves same-word batches from different
      // descriptors adjacent (see spaceOutPendingSeedBatches); space them
      // apart before they're lazily seeded one batch at a time.
      let spacedPendingSeeds = spaceOutPendingSeedBatches(pendingSeeds);

      const topUpCards: QueueCard[] = [];

      // Daily sentence top-ups: a floor for sentences' first
      // `reading_in_context` card (settings.dailyNewSentenceCardQuota) and first
      // `ear_tiles` card, which starts the Ear Tiles → dictation ladder
      // (settings.dailyNewAudioCardQuota). Each picked sentence is seeded as its
      // whole pending batch for that descriptor.
      const sentenceTopUps = [
        {
          key: SENTENCE_DESCRIPTOR_KEY,
          quota: settings.dailyNewSentenceCardQuota ?? 0,
          countedActivity: 'reading_in_context',
          pick: pickSentenceQuotaSubjects,
        },
        {
          key: AUDIO_DESCRIPTOR_KEY,
          quota: settings.dailyNewAudioCardQuota ?? 0,
          countedActivity: 'ear_tiles',
          pick: pickAudioQuotaSubjects,
        },
      ];
      let sentenceTopUpCount = 0;
      for (const topUp of sentenceTopUps) {
        const topUpDescriptor = descriptors.find((descriptor) => descriptor.key === topUp.key);
        if (!topUpDescriptor || cancelled) continue;
        const subjects = topUp.pick(
          spacedPendingSeeds,
          quotaRemaining(
            topUp.quota,
            await countSentencesSeededSince(topUp.countedActivity, startOfLocalDayIso(new Date())),
          ),
        );
        for (const subjectId of subjects) {
          const batch = spacedPendingSeeds.filter(
            (item) => item.descriptorKey === topUp.key && item.subjectId === subjectId,
          );
          topUpCards.push(
            ...(await Promise.all(
              batch.map(async (item) =>
                topUpDescriptor.buildCard(
                  await topUpDescriptor.ensure(item.candidate, item.activityType),
                  item.candidate,
                ),
              ),
            )),
          );
        }
        const seededSubjects = new Set(subjects);
        spacedPendingSeeds = spacedPendingSeeds.filter(
          (item) => !(item.descriptorKey === topUp.key && seededSubjects.has(item.subjectId)),
        );
        sentenceTopUpCount += subjects.length;
      }

      if (cancelled) return;
      setQueue([...spaced, ...topUpCards]);
      setPool(spacedPendingSeeds);
      // The top-ups count toward this sitting's new-card cap like any other new subject.
      setNewCardsIntroduced(sentenceTopUpCount);
      setInitialized(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, initialized, descriptors, settings, deepDiveSentenceId]);

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
  const currentSentenceId = current?.sentence.id;
  const historyCardId = current && (
    current.studyItem.activityType === 'reading_in_context' || current.studyItem.activityType === 'listening'
  ) ? current.studyItem.id : undefined;
  const [historyLoad, setHistoryLoad] = useState<
    { cardId: string; history: SentenceReviewHistory; weakTarget?: StructureCheckTarget; failed?: false } |
    { cardId: string; failed: true } | undefined
  >();
  const [historyRetry, setHistoryRetry] = useState(0);
  // From the sentence's second reading_in_context review onward (like the structure check), the card may
  // ask for the typed reading of the sentence's weakest word before reveal.
  const weakTargetSentence =
    current?.studyItem.activityType === 'reading_in_context' && current.studyItem.fsrsState.reps >= 1
      ? current.sentence
      : undefined;
  useEffect(() => {
    if (!historyCardId || !currentSentenceId) return;
    let cancelled = false;
    // A snapshot per card: history must arrive before the question samples its
    // choices, then remain fixed while the learner answers and rates it.
    void Promise.all([
      getSentenceReviewHistory(currentSentenceId),
      // A failed lookup only means no weak-word check; it must not block the card.
      weakTargetSentence ? getWeakWordRecallTarget(weakTargetSentence).catch(() => undefined) : undefined,
    ]).then(
      ([history, weakTarget]) => { if (!cancelled) setHistoryLoad({ cardId: historyCardId, history, weakTarget }); },
      () => { if (!cancelled) setHistoryLoad({ cardId: historyCardId, failed: true }); },
    );
    return () => { cancelled = true; };
  }, [historyCardId, currentSentenceId, historyRetry, weakTargetSentence]);
  const currentHistory = historyLoad?.cardId === historyCardId && !historyLoad?.failed
    ? historyLoad?.history : undefined;
  const currentWeakTarget = historyLoad?.cardId === historyCardId && !historyLoad?.failed
    ? historyLoad?.weakTarget : undefined;
  const sourceBooks = useLiveQuery(async () => {
    if (!currentSentenceId) return undefined;
    const db = getDb();
    const rows = await db.bookSentences.where('sentenceId').equals(currentSentenceId).toArray();
    const books = await db.books.bulkGet(rows.map((row) => row.bookId));
    return rows.map((row, index) => {
      const book = books[index];
      const chapter = row.chapterId ? book?.chapters?.find((c) => c.id === row.chapterId) : undefined;
      const shelved = book?.suspendedAt || chapter?.suspendedAt;
      return `${book?.title ?? row.bookId}${chapter ? ` › ${chapter.title}` : ''} (${shelved ? 'suspended' : 'active'})`;
    });
  }, [currentSentenceId]);

  useEffect(() => {
    const sync = () => cardTimerRef.current.setActive(pageIsActive());
    sync();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
    };
  }, []);

  useEffect(() => {
    cardTimerRef.current.reset();
    setRevealed(false);
    setAssistanceUsed(new Set());
    setTypedResponse('');
    setTypedResponseExpected(null);
    setComprehensionCheckAnswer(null);
    setMissedReadings([]);
    setTroubleTags([]);
    setPitchProductionEvidence(null);
    setReportingIssue(false);
    setIssueNote('');
    setIssueReported(false);
    setFreshTryStatus(null);
    setConfirmDeleteSentence(false);
  }, [current?.studyItem.id]);

  function markAssistance(kind: ReviewAssistance) {
    setAssistanceUsed((current) => (current.has(kind) ? current : new Set(current).add(kind)));
  }

  async function handleRate(rating: ReviewRating) {
    if (!current || submitting) return;
    setSubmitting(true);
    try {
      const expectedAnswerValue = typedResponseExpected ?? undefined;
      // Pitch-accent shape tracking (docs/STATUS.md): the H/L shape implied
      // by the chosen vs. correct drop position, purely for later
      // shape-confusion analysis — never used for grading, which already
      // happened in PitchAccentCard's onCheck.
      const pitchAccentShapes = current.pitchAccent
        ? {
            pitchExpectedShape: expectedPitchShape(
              current.pitchAccent.morae.length,
              current.pitchAccent.correctPosition,
            ).join(''),
            pitchChosenShape: typedResponse
              ? expectedPitchShape(
                  current.pitchAccent.morae.length,
                  Number(typedResponse),
                ).join('')
              : undefined,
          }
        : undefined;
      await recordReview({
        studyItemId: current.studyItem.id,
        rating,
        elapsedMs: cardTimerRef.current.elapsed(),
        assistance: assistanceUsed.size > 0 ? [...assistanceUsed] : undefined,
        responseRaw: typedResponse || undefined,
        expectedAnswer: typedResponse ? expectedAnswerValue : undefined,
        pitchExpectedShape: pitchAccentShapes?.pitchExpectedShape,
        pitchChosenShape: pitchAccentShapes?.pitchChosenShape,
        comprehensionCheckCorrect: comprehensionCheckAnswer?.correct,
        comprehensionCheckChosenIndex: comprehensionCheckAnswer?.chosenIndex,
        meaningChoice: comprehensionCheckAnswer?.meaningChoice,
        missedReadings:
          current.studyItem.activityType === 'reading_in_context' ? missedReadings : undefined,
        pitchProductionMeasuredCount: pitchProductionEvidence?.measuredCount,
        pitchProductionMismatchCount: pitchProductionEvidence?.mismatchCount,
        // The sentence this card actually displayed — every QueueCard has
        // one, not just pitch_accent (which used this alone, to join a miss
        // to the clip it played). Generalized 2026-09-22 so any activity's
        // miss can be traced back to a sentence — see "cross-activity error
        // routing" (docs/ROADMAP.md "Possibilities").
        contextSentenceId: current.sentence.id,
      });
      if (troubleTags.length > 0) {
        // Supplementary: a failure here must not undo the review just recorded.
        await recordReviewTroubleTags({
          studyItemId: current.studyItem.id,
          sentenceId: current.sentence.id,
          rating,
          tags: troubleTags,
        }).catch(() => undefined);
      }
      setQueue((q) => q.slice(1));

      // Session-aware auto-advance (2026-08-26 follow-up): once this
      // review completes the active session's `review` step's target
      // count, settle the step and jump straight to the next one, instead
      // of leaving the learner to notice and go back to Mark it complete.
      // But hold the step open while never-introduced sentences are still
      // waiting to be seeded this sitting, or the step would settle before
      // ReviewPage drains the pending-seed pool.
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
        diagnostics: await buildCardReportDiagnostics(current.studyItem, current.sentence.id),
      });
      setReportingIssue(false);
      setIssueNote('');
      setIssueReported(true);
    } finally {
      setSubmittingIssue(false);
    }
  }

  /**
   * Deletes the card's sentence everywhere (deleteSentenceCascade — same
   * soft-delete cascade as Search's "Delete selected everywhere") and drops
   * every queue/pool entry tied to it, so a bad or duplicate sentence spotted
   * mid-review doesn't have to be tracked down separately in Search.
   */
  async function handleDeleteSentence() {
    if (!current || deletingSentence) return;
    setDeletingSentence(true);
    try {
      const sentenceId = current.sentence.id;
      await deleteSentenceCascade(sentenceId);
      setQueue((q) => q.filter((card) => card.sentence.id !== sentenceId));
      setPool((p) => p.filter((seed) => pendingSeedSentenceId(seed) !== sentenceId));
      setConfirmDeleteSentence(false);
    } finally {
      setDeletingSentence(false);
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

        {sourceBooks && !bookId ? (
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            From: {sourceBooks.length > 0 ? sourceBooks.join('; ') : 'no book'}
          </div>
        ) : null}

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
            <span className="muted">
              Reviews are sentences you've already worked through in the gloss. Introduce a new
              sentence from the book page or today's plan and it will show up here.
            </span>
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
        ) : historyCardId && !currentHistory ? (
          historyLoad?.cardId === historyCardId && historyLoad.failed ? (
            <div role="alert">
              <p>Couldn't load this card's review history.</p>
              <button type="button" onClick={() => { setHistoryLoad(undefined); setHistoryRetry((value) => value + 1); }}>
                Retry
              </button>
            </div>
          ) : <p className="muted">Loading next card…</p>
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="muted">
                <ReviewStageIcon state={current.studyItem.fsrsState.state} />{' '}
                {ACTIVITY_LABELS[current.studyItem.activityType] ??
                  current.studyItem.activityType}{' '}
                · {queue.length} due
              </div>
              <div className="row">
                <Link to={`/study-items/${current.studyItem.id}`}>Why?</Link>
                {confirmDeleteSentence ? (
                  <>
                    <span className="muted">Delete this sentence everywhere?</span>
                    <button
                      type="button"
                      className="danger"
                      disabled={deletingSentence}
                      onClick={() => void handleDeleteSentence()}
                    >
                      Confirm delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteSentence(false)}
                      disabled={deletingSentence}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => setConfirmDeleteSentence(true)}
                  >
                    Delete sentence
                  </button>
                )}
              </div>
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
                <button
                  type="button"
                  onClick={() => {
                    void requestFreshTry(current.sentence.id).then(setFreshTryStatus);
                  }}
                >
                  Fresh try this sentence
                </button>
                {freshTryStatus === 'queued' ? (
                  <span className="muted">✓ Queued: it'll lead your next plan</span>
                ) : freshTryStatus === 'not_walked' ? (
                  <span className="muted">Not walked through yet</span>
                ) : null}
              </div>
            )}
            {current.audio && current.studyItem.activityType === EAR_TILES_ACTIVITY ? (
              <EarTilesCard
                key={current.studyItem.id}
                sentence={current.sentence}
                audio={current.audio}
                onDone={() => setRevealed(true)}
              />
            ) : current.audio && dictationTileIndex(current.studyItem.activityType) !== null ? (
              <DictationCard
                key={current.studyItem.id}
                sentence={current.sentence}
                tileIndex={dictationTileIndex(current.studyItem.activityType)!}
                audio={current.audio}
                revealed={revealed}
                onReplay={() => markAssistance('audio_replayed')}
                playbackRate={audioSpeed}
                onPlaybackRateChange={setAudioSpeed}
                onCheck={(value, gradedAgainst) => {
                  setTypedResponse(value);
                  setTypedResponseExpected(gradedAgainst);
                  setRevealed(true);
                }}
              />
            ) : current.audio ? (
              <AudioComprehensionCard
                key={current.studyItem.id}
                sentence={current.sentence}
                audio={current.audio}
                check={current.comprehensionCheck}
                history={currentHistory?.meaningChoices ?? []}
                revealed={revealed}
                onReveal={() => setRevealed(true)}
                onReplay={() => markAssistance('audio_replayed')}
                playbackRate={audioSpeed}
                onPlaybackRateChange={setAudioSpeed}
                onComprehensionAnswered={(correct, chosenIndex, meaningChoice) =>
                  setComprehensionCheckAnswer({ correct, chosenIndex, meaningChoice })
                }
              />
            ) : current.pitchAccent ? (
              <PitchAccentCard
                key={current.studyItem.id}
                onAssist={markAssistance}
                candidate={current.pitchAccent}
                revealed={revealed}
                quietMode={settings?.quietMode ?? false}
                onCheck={(value, gradedAgainst) => {
                  setTypedResponse(value);
                  setTypedResponseExpected(gradedAgainst);
                  setRevealed(true);
                }}
              />
            ) : current.pitchAccentProduction ? (
              <PitchAccentProductionCard
                key={current.studyItem.id}
                candidate={current.pitchAccentProduction}
                onAnalyzed={(measuredCount, mismatchCount) => {
                  setPitchProductionEvidence({ measuredCount, mismatchCount });
                  setRevealed(true);
                }}
              />
            ) : current.studyItem.activityType === 'reading_in_context' ? (
              <ReadingInContextCard
                key={current.studyItem.id}
                sentence={current.sentence}
                context={current.readingContext}
                check={current.comprehensionCheck}
                structureCheck={
                  // A word flagged "Missed reading" last time wins: ask for
                  // its reading before anything else.
                  pickMissedReadingTarget(
                    currentHistory?.missedReadings,
                    current.sentence.japanese,
                    current.sentence.inlineReading,
                  ) ??
                  // Then the sentence's weakest word by the strength model (second review onward):
                  // the retrieval the learner kept missing, asked as typed recall, not recognition.
                  currentWeakTarget ??
                  // Otherwise only from the sentence's second review onward —
                  // the first pass stays exactly as it always has, this is
                  // specifically the "repeat with less passive scaffolding"
                  // pass (docs/ROADMAP.md repetition brainstorm, 2026-09-29).
                  (current.studyItem.fsrsState.reps >= 1
                    ? pickStructureCheckChunk(current.analysisChunks, current.sentence.inlineReading)
                    : undefined)
                }
                analysisChunks={current.analysisChunks}
                onMissedReadingsChange={setMissedReadings}
                revealed={revealed}
                onReveal={() => setRevealed(true)}
                history={currentHistory?.meaningChoices ?? []}
                bookId={current.readingContext?.bookId ?? bookId}
                onComprehensionAnswered={(correct, chosenIndex, meaningChoice) =>
                  setComprehensionCheckAnswer({ correct, chosenIndex, meaningChoice })
                }
                onStructureCheckAnswered={(typed, expected) => {
                  setTypedResponse(typed);
                  setTypedResponseExpected(expected);
                }}
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
            {revealed ? <RevealedFurigana sentence={current.sentence} /> : null}
            {current.audio ? <ReviewClipAdjuster audioId={current.audio.id} /> : null}
            {revealed && current.audio ? (
              // Measured pitch of the native clip — directly under the
              // sentence, above the dictionary H/L row. Only on the
              // audio-centric cards (listening).
              <ReviewPitchContour audio={current.audio} />
            ) : null}
            {revealed &&
            current.studyItem.activityType !== 'pitch_accent' &&
            current.studyItem.activityType !== 'pitch_accent_production' ? (
              // Ambient pitch-accent contour for the sentence under review.
              // `pitch_accent`/`pitch_accent_production` render their own
              // (target-highlighted, and for production, learner-marked) copy.
              // `sentence_transformation`'s own inflected verb is included
              // here now too — getSentencePitchAccentTargets resolves each
              // occurrence's real conjugated contour via
              // resolveInflectedPitchAccent, dropping (not misdrawing) any
              // occurrence outside that resolver's narrow coverage.
              <>
                {!current.audio ? (
                  // The measured native contour, when the sentence has a
                  // reference clip — the listening cards above already show
                  // it from their own audio, so only add it for the rest.
                  <SentenceNativePitchContour sentenceId={current.sentence.id} />
                ) : null}
                <SentencePitchAccentRow
                  japanese={current.sentence.japanese}
                  sentenceId={current.sentence.id}
                />
              </>
            ) : null}
            {revealed ? (
              <div className="row" role="group" aria-label="What was hard? (optional)">
                <span className="muted">Trouble with:</span>
                {REVIEW_TROUBLE_TAGS.map((tag) => (
                  <button
                    key={tag.value}
                    type="button"
                    title={tag.hint}
                    aria-pressed={troubleTags.includes(tag.value)}
                    disabled={submitting}
                    onClick={() =>
                      setTroubleTags((tags) =>
                        tags.includes(tag.value)
                          ? tags.filter((value) => value !== tag.value)
                          : [...tags, tag.value],
                      )
                    }
                  >
                    {troubleTags.includes(tag.value) ? '✓ ' : ''}
                    {tag.label}
                  </button>
                ))}
              </div>
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

export interface StructureCheckTarget {
  japanese: string;
  expectedReading: string;
}

/**
 * Picks the (at most one) chunk of a sentence's saved structural analysis
 * worth a typed-recall production check on a `reading_in_context` review —
 * the first chunk whose role is a classic Cure-Dolly confusion
 * (`AMBIGUITY_PRONE_ROLES`, shared with AnalyzePage's guided walkthrough)
 * and whose reading can actually be derived from the sentence's
 * `inlineReading` markup. Returns undefined when neither condition is met
 * (no flagged role, or no reading data yet) — the card just falls back to
 * its existing behavior, same degrade-gracefully convention as everything
 * else keyed off `inlineReading`.
 */
export function pickStructureCheckChunk(
  chunks: AnalysisChunk[] | undefined,
  inlineReading: string,
): StructureCheckTarget | undefined {
  if (!chunks) return undefined;
  for (const chunk of chunks) {
    if (!AMBIGUITY_PRONE_ROLES.has(chunk.role)) continue;
    const expectedReading = surfaceReadingFromInline(inlineReading, chunk.japanese);
    if (expectedReading) return { japanese: chunk.japanese, expectedReading };
  }
  return undefined;
}

/**
 * First flagged word that's still in the sentence and has a derivable
 * reading, as a typed-reading check target. Undefined falls back to the
 * ordinary structure check.
 */
export function pickMissedReadingTarget(
  missed: string[] | undefined,
  japanese: string,
  inlineReading: string,
): StructureCheckTarget | undefined {
  for (const surface of missed ?? []) {
    if (!japanese.includes(surface)) continue;
    const expectedReading = surfaceReadingFromInline(inlineReading, surface);
    if (expectedReading) return { japanese: surface, expectedReading };
  }
  return undefined;
}

/**
 * `reading_in_context` card body — the sole sentence-subject card. Reveal
 * flow: see JP, optionally answer a structure check, optionally answer a
 * comprehension check, reveal EN + vocab, self-rate. The sentence under
 * test is framed by its reading-order neighbours (buildReadingContextMap):
 * the preceding sentences are shown untranslated above it so the passage
 * sets the scene without spoiling the answer, and the following sentence's
 * translation joins the reveal. With no context available (inbox-only
 * sentence, or a book-scoped queue whose neighbours aren't loaded) it
 * degrades to the isolated layout.
 *
 * When the sentence has an authored `check` (docs/ROADMAP.md "Context-aware
 * comprehension check…"), a 4-option "which English sentence fits this
 * context" pick gates the Reveal button — purely supplementary evidence
 * (`onComprehensionAnswered`, recorded as `Review.comprehensionCheckCorrect`),
 * never a rating override; self-rating afterward is unchanged. No check
 * authored → falls straight to the plain Reveal button, same as before this
 * feature existed.
 *
 * `structureCheck` (2026-09-29 repetition pass, docs/ROADMAP.md) is the
 * same shape of optional pre-reveal gate, one step earlier: only offered
 * from the sentence's second `reading_in_context` review onward
 * (`ReviewPage`'s call site checks `fsrsState.reps`), it marks one chunk
 * flagged as a classic Cure-Dolly confusion (`pickStructureCheckChunk`) and
 * asks the learner to type its reading, rather than just showing the
 * sentence again passively — evidence recorded via the same generic
 * `responseRaw`/`expectedAnswer` path every other typed-recall card uses
 * (`onStructureCheckAnswered` → `setTypedResponse`/`setTypedResponseExpected`
 * in `ReviewPage`), not a new field.
 */
function ReadingInContextCard({
  sentence,
  context,
  check,
  structureCheck,
  analysisChunks,
  revealed,
  onReveal,
  history,
  bookId,
  onComprehensionAnswered,
  onStructureCheckAnswered,
  onMissedReadingsChange,
}: {
  sentence: Sentence;
  context: ReadingContext | undefined;
  check: ComprehensionCheck | undefined;
  structureCheck: StructureCheckTarget | undefined;
  analysisChunks: AnalysisChunk[] | undefined;
  revealed: boolean;
  onReveal: () => void;
  history: MeaningChoiceRecord[];
  bookId: string | undefined;
  onComprehensionAnswered: (
    correct: boolean,
    chosenIndex: number,
    meaningChoice: MeaningChoiceRecord,
  ) => void;
  onStructureCheckAnswered: (typed: string, expected: string) => void;
  onMissedReadingsChange: (surfaces: string[]) => void;
}) {
  const before = context?.before ?? [];
  const after = context?.after ?? [];
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  const [structureValue, setStructureValue] = useState('');
  const [structureAnswered, setStructureAnswered] = useState(false);
  const [structureCorrect, setStructureCorrect] = useState(false);
  const contextIds = [...before, ...after].map((item) => item.id);
  const contextKey = contextIds.join(',');
  // Ambient connective tissue (docs/ROADMAP.md): a tracked grammar pattern
  // showing up again in the surrounding passage — not the target sentence
  // itself, which is under test.
  const grammarSpans = useLiveQuery(
    () => (contextIds.length ? getTrackedGrammarSpansForSentences(contextIds) : undefined),
    [contextKey],
  );

  // Sampled once per card mount so the four choices (and their order) stay
  // put while the learner reads them; `null` (no usable distractors) falls
  // back to a plain reveal rather than inventing choices.
  const [question] = useState(() =>
    check ? sampleMeaningQuestion(check, distractorHistoryFromRecords(history)) : null,
  );

  function choose(index: number) {
    if (chosenIndex !== null || !question) return;
    const choice = question.choices[index]!;
    setChosenIndex(index);
    onComprehensionAnswered(choice.isCorrect, index, {
      shown: question.choices.map((item) => item.text),
      chosenIndex: index,
      chosenText: choice.text,
      correctText: question.correctText,
      correct: choice.isCorrect,
      // The only pick this card offers, made before any reveal/hint.
      qualifying: true,
    });
  }

  const [beforeChunk, targetChunk, afterChunk] = structureCheck
    ? splitOnSurfaceForm(sentence.japanese, structureCheck.japanese)
    : [sentence.japanese, '', ''];

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
            <div key={item.id}>
              <p className="jp jp-sm reading-context-line">
                <ContextSentenceText sentence={item} span={grammarSpans?.get(item.id)} />
              </p>
              <ContextSentenceReading sentence={item} revealed={revealed} />
            </div>
          ))}
        </div>
      ) : null}
      <div className="jp jp-lg">
        {targetChunk ? (
          <>
            {beforeChunk}
            <mark>{targetChunk}</mark>
            {afterChunk}
          </>
        ) : (
          sentence.japanese
        )}
      </div>
      {structureCheck && !revealed && !structureAnswered ? (
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            const correct = isReadingAnswerCorrect(structureValue, structureCheck.expectedReading);
            setStructureCorrect(correct);
            setStructureAnswered(true);
            onStructureCheckAnswered(structureValue, structureCheck.expectedReading);
          }}
        >
          <label>
            Type the reading of the highlighted part
            <input
              type="text"
              value={structureValue}
              autoComplete="off"
              onChange={(event) => setStructureValue(event.target.value)}
            />
          </label>
          <button type="submit">Check</button>
        </form>
      ) : !revealed && question && chosenIndex === null ? (
        <div className="stack">
          {structureAnswered ? (
            <p className="muted" style={{ margin: 0 }}>
              {structureCorrect ? '✓ Correct' : '✗ Not quite'} — reading:{' '}
              <span className="jp">{structureCheck!.expectedReading}</span>
              {!structureCorrect ? (
                <>
                  {' '}
                  (you typed: <span className="jp">{structureValue.trim() || '(blank)'}</span>)
                </>
              ) : null}
            </p>
          ) : null}
          <p className="muted" style={{ margin: 0 }}>
            Which English sentence is the meaning of this sentence in context?
          </p>
          {question.choices.map((choice, i) => (
            <button key={choice.id} type="button" onClick={() => choose(i)}>
              {choice.text}
            </button>
          ))}
        </div>
      ) : !revealed ? (
        <>
          {structureAnswered ? (
            <p className="muted" style={{ margin: 0 }}>
              {structureCorrect ? '✓ Correct' : '✗ Not quite'} — reading:{' '}
              <span className="jp">{structureCheck!.expectedReading}</span>
              {!structureCorrect ? (
                <>
                  {' '}
                  (you typed: <span className="jp">{structureValue.trim() || '(blank)'}</span>)
                </>
              ) : null}
            </p>
          ) : null}
          {question && chosenIndex !== null ? (
            <div className="stack">
              <p style={{ fontWeight: 600, margin: 0 }}>
                {question.choices[chosenIndex]!.isCorrect ? '✓ Correct' : '✗ Not quite'}
              </p>
              {!question.choices[chosenIndex]!.isCorrect ? (
                <>
                  <p style={{ margin: 0 }}>
                    It means: <strong>{question.correctText}</strong>
                  </p>
                  {bookId ? (
                    <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                      Want to see why? The{' '}
                      <Link to={`/books/${bookId}/learn/${sentence.id}?skipCheck=1`}>
                        guided gloss for this sentence
                      </Link>{' '}
                      has its vocabulary and grammar — come back to Review after.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
          <button type="button" onClick={onReveal}>
            Reveal
          </button>
        </>
      ) : (
        <>
          <div>{sentence.translation || '(no translation)'}</div>
          <VocabChips items={sentence.targetVocabulary} />
          <ReadingHelpPanel
            sentence={sentence}
            chunks={analysisChunks}
            onMissedChange={onMissedReadingsChange}
          />
          {after.length ? (
            <div className="reading-context">
              {after.map((item) => (
                <div key={item.id}>
                  <p className="reading-context-line">
                    <span className="jp jp-sm">
                      <ContextSentenceText sentence={item} span={grammarSpans?.get(item.id)} />
                    </span>
                    {item.translation ? (
                      <span className="muted"> — {item.translation}</span>
                    ) : null}
                  </p>
                  <ContextSentenceReading sentence={item} revealed={revealed} />
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

/**
 * The sentence with furigana over its kanji, shown only after reveal so it
 * never hands over the reading beforehand. Renders nothing when the stored
 * inline reading is missing, has no ruby, or no longer matches the text.
 */
function RevealedFurigana({ sentence }: { sentence: Sentence }) {
  const { inlineReading, japanese } = sentence;
  if (!inlineReading) return null;
  const segments = parseInlineReadings(inlineReading);
  if (segments.map((segment) => segment.base).join('') !== japanese) return null;
  if (!segments.some((segment) => segment.kind === 'ruby')) return null;
  return (
    <div className="jp jp-lg muted">
      <FuriganaText text={inlineReading} />
    </div>
  );
}

/** "Adjust clip" for a card's reference audio; needs a YouTube source URL on the clip or its book. */
function ReviewClipAdjuster({ audioId }: { audioId: string }) {
  const resolved = useLiveQuery(async () => {
    const db = getDb();
    const audio = await db.sentenceAudio.get(audioId);
    if (!audio) return null;
    let sourceUrl = audio.sourceUrl;
    if (!sourceUrl) {
      const links = await db.bookSentences.where('sentenceId').equals(audio.sentenceId).toArray();
      for (const link of links) {
        sourceUrl = (await db.books.get(link.bookId))?.sourceUrl;
        if (sourceUrl) break;
      }
    }
    return sourceUrl ? { audio, sourceUrl } : null;
  }, [audioId]);
  if (!resolved) return null;
  return <SentenceAudioAdjuster audio={resolved.audio} sourceUrl={resolved.sourceUrl} />;
}

/**
 * One passage context line, with its tracked grammar occurrence (if any)
 * highlighted — `span` is `undefined` while spans are still loading and
 * absent for a line with nothing tracked, both of which just render the
 * plain sentence.
 */
function ContextSentenceText({
  sentence,
  span,
}: {
  sentence: Sentence;
  span: TrackedGrammarSpan | undefined;
}) {
  if (!span) return <>{sentence.japanese}</>;
  return (
    <>
      {sentence.japanese.slice(0, span.start)}
      <mark title={span.patternName}>{sentence.japanese.slice(span.start, span.end)}</mark>
      {sentence.japanese.slice(span.end)}
    </>
  );
}

/**
 * A context sentence's hiragana reading, on its own line underneath it —
 * withheld until `revealed` so a passage line the card shows up front
 * doesn't hand over reading practice before the learner has attempted it.
 */
function ContextSentenceReading({
  sentence,
  revealed,
}: {
  sentence: Sentence;
  revealed: boolean;
}) {
  if (!revealed || !sentence.readingOnly) return null;
  return <p className="jp jp-sm muted reading-context-reading">{sentence.readingOnly}</p>;
}

const PITCH_ACCENT_PATTERN_LABELS: Record<PitchAccentPattern, string> = {
  heiban: 'Heiban (平板)',
  atamadaka: 'Atamadaka (頭高)',
  nakadaka: 'Nakadaka (中高)',
  odaka: 'Odaka (尾高)',
};

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
  onAssist,
  quietMode,
}: {
  candidate: PitchAccentReviewCandidate;
  revealed: boolean;
  onCheck: (chosenPosition: string, correctPosition: string) => void;
  /** Usage tracking — lands in the review's `assistance` log. */
  onAssist: (kind: ReviewAssistance) => void;
  /** Can't speak aloud right now — hide the "Practice this word" live-shadowing step. */
  quietMode: boolean;
}) {
  const { vocabularyItem, sentence, surfaceForm, audio, reading, morae, correctPosition, correctLabel } =
    candidate;
  const [selected, setSelected] = useState<number | null>(null);
  // Long words score far worse than short ones (report-pitch-drill-
  // effectiveness.ts, 2026-09-27: lhhl 36%, hll 40% vs. hl/lh 53-61%) —
  // comparing 5-6 full contour diagrams side by side at once is plausibly
  // just harder to hold in mind than 2-3. For those words, narrow to a
  // rough half of the word first, then show only that half's contours.
  const [narrowedHalf, setNarrowedHalf] = useState<'early' | 'late' | null>(null);
  // The span the native-word loop plays (alignment or hand-adjusted), so the
  // reveal can draw that same span's *measured* pitch beside the dictionary
  // diagram — the bridge from "what I heard" to "what the contour is".
  const [wordSpan, setWordSpan] = useState<TimeRangeMs | null>(null);
  const audioBlob = useSentenceAudioBlob(audio);
  const [before, target, after] = splitOnSurfaceForm(sentence.japanese, surfaceForm);

  // Live pitch biofeedback (2026-09-27): loops the isolated word/phrase span
  // hands-free while the learner shadows it, drawing their pitch live
  // against the real measured native contour instead of only showing it
  // after the fact — same substrate as ShadowPage's "Close shadow" loop.
  // Unscored: purely supplementary practice, no onCheck/rating involvement.
  const shadowing = useShadowing();
  const { cancelRecording, updateShadowLoop } = shadowing;
  const [practiceSpeed, setPracticeSpeed] = useState(1);
  useEffect(() => () => cancelRecording(), [cancelRecording]);
  // Keep speed live-adjustable while the loop is running, same as
  // ShadowPage's own speed selector — many native clips are just too fast
  // to shadow at 1x (user report, 2026-09-28).
  useEffect(() => {
    if (shadowing.shadowActive) updateShadowLoop({ playbackRate: practiceSpeed });
  }, [practiceSpeed, shadowing.shadowActive, updateShadowLoop]);
  function handleTogglePractice() {
    if (shadowing.shadowActive) {
      shadowing.stopShadowLoop();
      return;
    }
    if (!audioBlob || !wordSpan) return;
    void shadowing.startShadowLoop(audioBlob, {
      range: wordSpan,
      playbackRate: practiceSpeed,
      onRep: () => {},
    });
  }

  // Drop positions 0..N. 0 = no downstep; N (= morae.length) is odaka —
  // indistinguishable from heiban within the word, which is why the native
  // clip (whose trailing particle drops for odaka, stays high for heiban)
  // plays before the learner answers. A word falls once at most, so each
  // choice is one whole contour, drawn textbook-style (overline over the
  // high morae, a vertical stroke at the downstep) by PitchChoiceContour.
  const positionChoices = Array.from({ length: morae.length + 1 }, (_, index) => index);
  const dropCaption = (position: number) =>
    position === 0 ? 'Stays high (no fall)' : `Falls after mora ${position}`;

  const LONG_WORD_MORA_THRESHOLD = 4;
  const isLongWord = morae.length >= LONG_WORD_MORA_THRESHOLD;
  const halfwayPosition = Math.floor(morae.length / 2);
  const earlyChoices = positionChoices.filter((position) => position <= halfwayPosition);
  const lateChoices = positionChoices.filter((position) => position > halfwayPosition);
  const showHalfPicker = isLongWord && narrowedHalf === null;
  const visibleChoices = !isLongWord
    ? positionChoices
    : narrowedHalf === 'late'
      ? lateChoices
      : earlyChoices;

  return (
    <>
      <div className="jp jp-lg">
        {before}
        <mark>{target || surfaceForm}</mark>
        {after}
      </div>
      <div className="jp">{reading}</div>

      <PitchAccentNativeAudio
        audio={audio}
        japanese={sentence.japanese}
        surfaceForm={surfaceForm}
        link={candidate.link}
        onRangeChange={setWordSpan}
        onLoopStart={() => onAssist('pitch_native_looped')}
      />

      {correctPosition === 0 || correctPosition === morae.length ? (
        <PitchWordPhraseWarmup
          audio={audio}
          japanese={sentence.japanese}
          surfaceForm={surfaceForm}
          isHeiban={correctPosition === 0}
        />
      ) : null}

      {!revealed ? (
        <>
          <div className="muted">
            A word&rsquo;s pitch falls once at most. Listen, then mark where it falls.
          </div>
          {showHalfPicker ? (
            <div className="row" style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
              <button
                type="button"
                className="pa-choice-button"
                onClick={() => setNarrowedHalf('early')}
              >
                Doesn&rsquo;t fall, or falls by mora {halfwayPosition}
              </button>
              <button
                type="button"
                className="pa-choice-button"
                onClick={() => setNarrowedHalf('late')}
              >
                Falls later — mora {halfwayPosition + 1} or beyond
              </button>
            </div>
          ) : (
            <>
              {isLongWord ? (
                <button
                  type="button"
                  className="ghost"
                  style={{ fontSize: '0.75rem', alignSelf: 'flex-start' }}
                  onClick={() => setNarrowedHalf(null)}
                >
                  ← Back
                </button>
              ) : null}
              <div className="row" style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
                {visibleChoices.map((position) => (
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
          )}
        </>
      ) : (
        <>
          <div className="muted">
            {selected === correctPosition ? '✓ Correct' : '✗ Not quite'}
          </div>
          {selected !== null && selected !== correctPosition ? (
            <div className="row" style={{ alignItems: 'center', gap: '0.4rem' }}>
              <span className="muted">You chose:</span>
              <PitchChoiceContour morae={morae} position={selected} />
              <span className="muted" style={{ fontSize: '0.75rem' }}>
                {dropCaption(selected)}
              </span>
            </div>
          ) : null}
          <div>
            {PITCH_ACCENT_PATTERN_LABELS[correctLabel]} —{' '}
            {correctPosition === 0 ? 'no downstep' : `downstep after mora ${correctPosition}`}
          </div>
          <PitchAccentDiagram reading={reading} position={correctPosition} />
          <WordPitchContour
            audioId={audio.id}
            blob={audioBlob}
            span={wordSpan}
            label="Native pitch of this word (measured)"
            ariaLabel={`Measured native pitch of ${surfaceForm}`}
          />
          {!quietMode && audioBlob && wordSpan ? (
            <div className="stack">
              <div className="row" style={{ alignItems: 'center' }}>
                <button type="button" onClick={handleTogglePractice}>
                  {shadowing.shadowActive ? '⏹ Stop' : '🔁 Practice this word'}
                </button>
                <SpeedControl speed={practiceSpeed} onChange={setPracticeSpeed} />
              </div>
              {shadowing.shadowActive ? (
                <LiveShadowWaveform
                  referenceBlob={audioBlob}
                  range={wordSpan}
                  active={shadowing.shadowActive}
                  getMediaTime={shadowing.getShadowMediaTime}
                  analyser={shadowing.getShadowAnalyser()}
                  sampleRate={shadowing.getShadowSampleRate()}
                />
              ) : null}
              {shadowing.error ? <p className="muted">{shadowing.error}</p> : null}
            </div>
          ) : null}
          {selected !== null && selected !== correctPosition ? (
            <PitchContrastExample
              moraCount={morae.length}
              chosenPosition={selected}
              correctPosition={correctPosition}
              vocabularyItemId={vocabularyItem.id}
              reading={reading}
              sentenceId={sentence.id}
              onShown={() => onAssist('pitch_contrast_shown')}
              onPlayed={() => onAssist('pitch_contrast_played')}
            />
          ) : null}
          <SentencePitchAccentRow
            japanese={sentence.japanese}
            sentenceId={sentence.id}
            highlightSurfaceForm={surfaceForm}
          />
          {(() => {
            // Deliberately the *dictionary* reading/position/moraCount, even
            // for an inflected occurrence: this explains the base word's own
            // lexical accent class, not the conjugated form's contour.
            const dictionaryMoraCount = segmentIntoMorae(vocabularyItem.reading).length;
            const explanation = explainPitchAccent({
              expression: vocabularyItem.expression,
              reading: vocabularyItem.reading,
              partOfSpeech: vocabularyItem.partOfSpeech,
              position: vocabularyItem.pitchAccentPositions?.[0] ?? correctPosition,
              moraCount: dictionaryMoraCount,
              conjugationFormKey: candidate.conjugationFormKey,
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
 * Pitch-accent *production* (docs/ROADMAP.md "Pull the pitch-accent
 * production drill into a review card…", shipped 2026-09-24): record the
 * whole sentence, score every target word's realized pitch against its
 * dictionary shape (`analyzePitchAccentDrillRecording`, the same pipeline
 * `PitchAccentDrillPage`'s free-practice loop uses), show the learner's
 * measured per-mora H/L as a second line under the dictionary marks, then
 * self-rate via the shared `RATINGS` row — same house convention as every
 * other card in this app: the objective score is feedback and supplementary
 * evidence (`onAnalyzed` → `Review.pitchProductionMeasuredCount`/
 * `pitchProductionMismatchCount`), never an auto-picked rating.
 *
 * Unlike every other card, there's no separate "reveal" action — recording
 * *is* the answer, so `onAnalyzed` (called once scoring finishes) is what
 * flips the parent's `revealed` flag and shows the rating buttons. When
 * alignment fails (`status: 'unavailable'`), `onAnalyzed` is *not* called —
 * no rating is possible on an unmeasured take, so the learner just
 * re-records; nothing is submitted for that attempt.
 */
function PitchAccentProductionCard({
  candidate,
  onAnalyzed,
}: {
  candidate: PitchAccentDrillSentence;
  onAnalyzed: (measuredCount: number, mismatchCount: number) => void;
}) {
  const shadowing = useShadowing();
  const { cancelRecording } = shadowing;
  const [pending, setPending] = useState<{ blob: Blob; durationMs: number } | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PitchAccentDrillAnalysisState>({ status: 'idle' });

  useEffect(() => () => cancelRecording(), [cancelRecording]);

  useEffect(() => {
    if (shadowing.status === 'stopped' && shadowing.lastRecording) {
      setPending(shadowing.lastRecording);
    }
  }, [shadowing.status, shadowing.lastRecording]);

  useEffect(() => {
    if (!pending) {
      setPendingUrl(null);
      return;
    }
    const url = URL.createObjectURL(pending.blob);
    setPendingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    let active = true;
    setAnalysis({ status: 'analyzing' });
    void analyzePitchAccentDrillRecording(
      pending.blob,
      candidate.sentence.japanese,
      candidate.targets,
    ).then((next) => {
      if (!active) return;
      setAnalysis(next);
      if (next.status === 'done') {
        onAnalyzed(next.scorableCount, next.observations.length);
      }
    });
    return () => {
      active = false;
    };
  }, [pending, candidate]);

  const isRecording = shadowing.status === 'recording';
  const isRequestingMic = shadowing.status === 'requesting-mic';
  const learnerClasses = analysis.status === 'done' ? analysis.learnerClassesBySurface : undefined;
  const learnerFollowing = analysis.status === 'done' ? analysis.learnerFollowingBySurface : undefined;

  return (
    <>
      <SentencePitchAccentText
        japanese={candidate.sentence.japanese}
        targets={candidate.targets}
        learnerClassesBySurface={learnerClasses}
        learnerFollowingBySurface={learnerFollowing}
      />
      {candidate.sentence.translation ? (
        <div className="muted">{candidate.sentence.translation}</div>
      ) : null}
      <div className="row" style={{ alignItems: 'center' }}>
        <RecordToggleButton
          isRecording={isRecording}
          isRequestingMic={isRequestingMic}
          elapsedMs={shadowing.recordingElapsedMs}
          maxDurationMs={MAX_RECORDING_DURATION_MS}
          idleLabel={pending ? 'Record again' : 'Record'}
          onStart={() => void shadowing.startRecording()}
          onStop={() => void shadowing.stopRecording()}
        />
      </div>
      {shadowing.error ? <p className="muted">{shadowing.error}</p> : null}
      {analysis.status === 'analyzing' ? <p className="muted">Scoring…</p> : null}
      {analysis.status === 'unavailable' ? (
        <p className="muted">Couldn&rsquo;t measure that take — try recording again.</p>
      ) : null}
      {pendingUrl && analysis.status === 'done' ? (
        <div className="stack">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={pendingUrl} />
          {analysis.learnerPitch ? (
            <MeasuredPitchContour
              payload={analysis.learnerPitch}
              label="Your pitch (measured)"
              ariaLabel="Measured pitch of your recording"
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * Audio comprehension (Phase 7.4, docs brief §5D): audio plays first with
 * the Japanese text hidden. Reveal is staged in two steps rather than one:
 * "Reveal text" first shows only the Japanese, so the
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
 * vocabulary suggestions, with tap-for-gloss on each glossed token.
 */
/**
 * Measured native-clip pitch track under a revealed audio card, with a
 * playback playhead and a loop toggle for studying the contour. Own
 * component so the (async, decode-backed) load + the rAF playhead loop
 * don't add hooks to the ReviewPage body — mounts only on an audio card.
 */
function ReviewPitchContour({ audio }: { audio: SentenceAudio }) {
  const [payload, setPayload] = useState<PitchAnalysisPayload>();
  const native = useNativeAudio();
  const loopRequestedRef = useRef(false);
  const [progress, setProgress] = useState<number | null>(null);

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

  const active = native.isPlaying && native.activeItemId === audio.id;
  const looping = active && loopRequestedRef.current;
  const duration = payload?.durationSeconds ?? 0;

  // The loop plays through the global singleton, so it would otherwise keep
  // going after the card advances; stop it only if it is still our clip.
  useEffect(
    () => () => {
      if (loopRequestedRef.current) nativeAudioController.stop();
    },
    [],
  );

  useEffect(() => {
    if (!active) {
      loopRequestedRef.current = false;
      setProgress(null);
      return;
    }
    if (!duration) return;
    let frame = 0;
    const tick = () => {
      setProgress(Math.max(0, Math.min(1, native.getCurrentTime() / duration)));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, duration, native.getCurrentTime]);

  if (!payload) return <MeasuredPitchContour payload={payload} />;

  return (
    <div className="stack" style={{ gap: '0.2rem' }}>
      <MeasuredPitchContour payload={payload} progress={progress} height={64} />
      <button
        type="button"
        className={`speak-button${looping ? ' speaking' : ''}`}
        aria-pressed={looping}
        style={{ alignSelf: 'flex-start' }}
        onClick={() => {
          if (looping) {
            native.stop();
            loopRequestedRef.current = false;
          } else {
            loopRequestedRef.current = true;
            void native.play(audio, 1, { loop: true });
          }
        }}
      >
        {looping ? '🔁 Looping…' : '🔁 Loop sentence'}
      </button>
    </div>
  );
}

/**
 * Loads a sentence's first reference recording, if it has one, and shows
 * its measured native pitch contour — for the review cards whose reveal
 * otherwise carries only the dictionary H/L row (comprehension,
 * reading_in_context, grammar, …). Renders nothing when the sentence has no
 * reference audio. The audio-centric cards (listening / word_listening)
 * already mount `ReviewPitchContour` straight from their own candidate, so
 * the caller gates this out there to avoid a duplicate contour.
 */
function SentenceNativePitchContour({ sentenceId }: { sentenceId: string }) {
  const audio = useLiveQuery(
    () => getDb().sentenceAudio.where('sentenceId').equals(sentenceId).first(),
    [sentenceId],
  );
  if (!audio) return null;
  return (
    <>
      <ReviewPitchContour audio={audio} />
      <ReviewClipAdjuster audioId={audio.id} />
    </>
  );
}

/**
 * `ear_tiles` card body: the walkthrough's old warm-up as its own review card —
 * hear the clip, tap the tiles that were said in order, skip the fakes. Finishing
 * the puzzle reveals the self-rate buttons (the 4-point rating still sets the
 * schedule). Particle fakes are logged to the gloss decision log as before, when
 * the sentence's book can be found. This card is the stepping stone `dictation_tile`
 * cards wait on.
 */
function EarTilesCard({
  sentence,
  audio,
  onDone,
}: {
  sentence: Sentence;
  audio: SentenceAudio;
  onDone: () => void;
}) {
  const visitId = useMemo(() => createId('visit'), []);
  // Chosen once so the bank doesn't reshuffle under the learner.
  const puzzle = useMemo(
    () => buildCheckPuzzle(sentence, visitId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sentence.id, visitId],
  );
  if (!puzzle) return <div className="muted">This sentence no longer splits into tiles.</div>;
  return (
    <EarTilesCheck
      sentenceId={sentence.id}
      visitId={visitId}
      puzzle={puzzle}
      audio={audio}
      onRecord={(decision) => {
        void getDb()
          .bookSentences.where('sentenceId')
          .equals(sentence.id)
          .first()
          .then((membership) => {
            if (membership) void logGlossDecision({ ...decision, bookId: membership.bookId });
          });
      }}
      finishLabel="Rate this card"
      onFinish={onDone}
    />
  );
}

/**
 * `dictation` card body: play the native clip (text hidden), type what you
 * hear, "Check" — then the written sentence is shown with the missed runs
 * marked against your answer, plus the translation. Either the written
 * sentence or its kana reading counts as correct (see gradeDictation). The
 * ✓/✗ is supplementary evidence only; the 4-point self-rate after Check is
 * still the scheduling signal. `onCheck`'s second argument is whichever
 * target the answer was graded against, recorded as `Review.expectedAnswer`.
 */
function DictationCard({
  sentence,
  tileIndex,
  audio,
  revealed,
  onReplay,
  playbackRate,
  onPlaybackRateChange,
  onCheck,
}: {
  sentence: Sentence;
  /** Which of the sentence's tiles (src/lib/earTiles.ts) to type. */
  tileIndex: number;
  audio: SentenceAudio;
  revealed: boolean;
  /** Called on every play *after* the first — the first play is the exercise itself, not assistance. */
  onReplay: () => void;
  playbackRate: number;
  onPlaybackRateChange: (value: number) => void;
  onCheck: (typed: string, gradedAgainst: string) => void;
}) {
  const playCountRef = useRef(0);
  const tile: TileDictation | null = useMemo(
    () => buildTileDictation(sentence, tileIndex),
    [sentence, tileIndex],
  );
  const [value, setValue] = useState('');
  const [grade, setGrade] = useState<DictationGrade | null>(null);

  const renderSegments = (segments: DictationGrade['typedSegments']) =>
    segments.map((segment, index) =>
      segment.matched ? (
        <span key={index}>{segment.text}</span>
      ) : (
        <mark key={index}>{segment.text}</mark>
      ),
    );

  return (
    <>
      <div className="row" style={{ alignItems: 'center' }}>
        <NativeAudioButton
          audio={audio}
          displayLabel="Play audio"
          playbackRate={playbackRate}
          loopable
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
            {PLAYBACK_SPEEDS.map((item) => (
              <option key={item} value={item}>
                {item === 1 ? '1× (normal)' : `${item}×`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!revealed ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            const result = gradeDictation(value, tile?.text ?? sentence.japanese, tile ? tile.reading : sentence.readingOnly);
            setGrade(result);
            onCheck(value, result.gradedAgainst);
          }}
        >
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Romaji is fine: type it as it sounds and it is read as kana. を = o or wo, particle は = ha, へ = he, long
            vowels as in hiragana (ou, oo, ei) or - for ー, ti = ティ. Kanji, katakana and hiragana all work too.
          </p>
          {tile ? (
            <div className="jp jp-lg" aria-label="Sentence with one phrase missing">
              {tile.before}<span style={{ borderBottom: '2px dashed var(--accent)', padding: '0 0.6rem' }}>＿＿</span>{tile.after}
            </div>
          ) : null}
          <label>
            {tile ? 'Type the missing phrase (kanji, kana or romaji)' : 'Type what you hear (kanji, kana or romaji)'}
            <textarea
              rows={tile ? 1 : 2}
              lang="ja"
              value={value}
              autoComplete="off"
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <button type="submit">Check</button>
        </form>
      ) : (
        <>
          <div className="muted">{grade?.correct ? '✓ Correct' : '✗ Not quite'}</div>
          <div className="muted">
            You typed:{' '}
            <span className="jp">
              {!value.trim()
                ? '(blank)'
                : grade && !grade.correct && !typedAsKana(value)
                  ? renderSegments(grade.typedSegments)
                  : value.trim()}
            </span>
          </div>
          {typedAsKana(value) ? (
            <div className="muted">
              As kana:{' '}
              <span className="jp">
                {grade && !grade.correct
                  ? renderSegments(grade.typedSegments)
                  : (grade?.typedKana ?? typedAsKana(value))}
              </span>
            </div>
          ) : null}
          <div className="jp jp-lg">
            {tile ? tile.before : null}
            {tile ? <strong>{grade ? renderSegments(grade.expectedSegments) : tile.text}</strong> : grade ? renderSegments(grade.expectedSegments) : sentence.japanese}
            {tile ? tile.after : null}
          </div>
          {!tile && grade && grade.gradedAgainst !== sentence.japanese ? (
            <div className="jp">{sentence.japanese}</div>
          ) : null}
          <div>{sentence.translation || '(no translation)'}</div>
          <VocabChips items={sentence.targetVocabulary} />
        </>
      )}
    </>
  );
}

/**
 * `listening` card body. Reveal flow: audio only, text hidden — then
 * "Reveal text" — then "Reveal translation" — self-rate. When the sentence
 * has an authored comprehension `check` (same data `reading_in_context`
 * uses, docs/ROADMAP.md "Context-aware comprehension check…"), a 4-option
 * "which English sentence best describes what you heard?" pick gates
 * "Reveal text" — purely supplementary evidence (`onComprehensionAnswered`,
 * recorded as `Review.comprehensionCheckCorrect`), never a rating override.
 * No check authored → falls straight to the plain "Reveal text" button,
 * same as before this existed.
 */
function AudioComprehensionCard({
  sentence,
  audio,
  check,
  history,
  revealed,
  onReveal,
  onReplay,
  playbackRate,
  onPlaybackRateChange,
  onComprehensionAnswered,
}: {
  sentence: Sentence;
  audio: SentenceAudio;
  check: ComprehensionCheck | undefined;
  history: MeaningChoiceRecord[];
  revealed: boolean;
  onReveal: () => void;
  /** Called on every play *after* the first — the first play is the exercise itself, not assistance. */
  onReplay: () => void;
  playbackRate: number;
  onPlaybackRateChange: (value: number) => void;
  onComprehensionAnswered: (
    correct: boolean,
    chosenIndex: number,
    meaningChoice: MeaningChoiceRecord,
  ) => void;
}) {
  const playCountRef = useRef(0);
  const [textRevealed, setTextRevealed] = useState(false);
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  const [question] = useState(() =>
    check ? sampleMeaningQuestion(check, distractorHistoryFromRecords(history)) : null,
  );

  function choose(index: number) {
    if (chosenIndex !== null || !question) return;
    const choice = question.choices[index]!;
    setChosenIndex(index);
    onComprehensionAnswered(choice.isCorrect, index, {
      shown: question.choices.map((item) => item.text),
      chosenIndex: index,
      chosenText: choice.text,
      correctText: question.correctText,
      correct: choice.isCorrect,
      qualifying: true,
    });
  }

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
      {!textRevealed && question && chosenIndex === null ? (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            Which English sentence best describes what you heard?
          </p>
          {question.choices.map((choice, i) => (
            <button key={choice.id} type="button" onClick={() => choose(i)}>
              {choice.text}
            </button>
          ))}
        </div>
      ) : !textRevealed ? (
        <>
          {question && chosenIndex !== null ? (
            <p style={{ fontWeight: 600 }}>
              {question.choices[chosenIndex]!.isCorrect ? '✓ Correct' : '✗ Not quite'}
            </p>
          ) : (
            <p className="muted">Listen and see how much you understand before revealing.</p>
          )}
          <button type="button" onClick={() => setTextRevealed(true)}>
            Reveal text
          </button>
        </>
      ) : (
        <>
          <KaraokeSentenceText
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

