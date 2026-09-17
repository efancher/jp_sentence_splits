import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { KaraokeSentenceText } from '../components/KaraokeSentenceText';
import { MeasuredPitchContour } from '../components/MeasuredPitchContour';
import { NativeAudioButton } from '../components/NativeAudioButton';
import { PitchAccentDiagram } from '../components/PitchAccentDiagram';
import { PitchAccentNativeAudio } from '../components/PitchAccentNativeAudio';
import { PitchChoiceContour } from '../components/PitchChoiceContour';
import { PitchWordPhraseWarmup } from '../components/PitchWordPhraseWarmup';
import { SegmentLoopPlayer } from '../components/SegmentLoopPlayer';
import { SentencePitchAccentRow } from '../components/SentencePitchAccentRow';
import { VocabChips } from '../components/VocabChips';
import {
  countReviewsSince,
  deferUnreadyGrammarReviews,
  deferUnreadyReadingInContextReviews,
  deferUnreadySentenceReviews,
  ensureGrammarStudyItem,
  ensureStudyItem,
  ensureVocabularyStudyItem,
  getConfusionPairCandidates,
  getDb,
  getDueStudyItems,
  getReferencePitchTrack,
  loadSuspendedBookIndex,
  saveReferencePitchTrack,
  getProficientReadingVocabularyItemIds,
  getSentenceFullReviewReadiness,
  getSentenceListeningReadiness,
  getVocabularyOccurrenceCandidates,
  getVocabularyTargetCandidates,
  pickContextSentenceForGrammarPattern,
  readSettings,
  recordReview,
  reportCardIssue,
  settleSessionStep,
  updatePlannerSessionStep,
  type ConfusionPairCandidate,
  type VocabularyOccurrenceCandidate,
  type VocabularyTargetCandidate,
} from '../db/repository';
import { useActiveSession } from '../hooks/useActiveSession';
import { useNativeAudio } from '../hooks/useNativeAudio';
import { sessionStepTargetPath } from '../lib/sessionPlanner';
import type {
  Book,
  GrammarPattern,
  ReviewAssistance,
  ReviewRating,
  Sentence,
  SentenceAudio,
  SentenceVocabulary,
  StudyActivityType,
  StudyItem,
  VocabularyItem,
} from '../domain/types';
import {
  conjugate,
  conjugationWordClassFromPartOfSpeech,
  findInflectedSurfaceInSentence,
  identifyConjugationForm,
  type ConjugationForm,
  type ConjugationFormKey,
  type ConjugationWordClass,
} from '../lib/conjugation';
import {
  blankPatternInSentence,
  isGrammarPatternAnswerCorrect,
} from '../lib/grammarPatterns';
import { containsKanji } from '../lib/kanji';
import { buildReadingContextMap, type ReadingContext } from '../lib/readingContext';
import { sentenceIsSuspendedOnly } from '../lib/suspendedBooks';
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
import { isReadingAnswerCorrect, surfaceReadingFromInline } from '../lib/readingAnswer';
import { PLAYBACK_SPEEDS } from '../lib/recording';
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
 * Gating: the Phase 7.11 full-sentence gate on the sentence's own
 * vocabulary (`ActivityDescriptor.gateSentenceId`), *plus* — since a
 * passage is only worth studying once you can actually read it — every
 * sentence shown in the surrounding passage must itself be full-review
 * ready (user request, 2026-09-03, via the descriptor's `activityIsReady`).
 *
 * History: this was two types — a plain isolated `comprehension` and
 * `reading_in_context`. `comprehension` was retired 2026-09-08 (user:
 * "always better to learn in context if possible"); its existing study
 * items were migrated to `reading_in_context`
 * (scripts/migrate-comprehension-to-reading-in-context.ts).
 */
const SENTENCE_ACTIVITY_TYPES: StudyActivityType[] = ['reading_in_context'];

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
 *
 * The two reading cards only seed for a word whose dictionary form has
 * kanji — for an all-kana lemma (する, わかる, テレビ) there's no reading to
 * recall and both degenerate to copying the on-screen kana. See the
 * `vocabulary` descriptor's `activityIsReady`; `cloze` still seeds.
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
 * word's own reading/meaning proficiency (tier 1, ActivityDescriptor.isReady
 * → getProficientReadingVocabularyItemIds — scoped to reading_retrieval/
 * cloze/reading_production specifically since 2026-09-16; `pitch_accent`
 * reps on the same subject don't count here), and in turn the full-sentence
 * `listening` card is gated behind *these* plus its own separate
 * `pitch_accent`-proficiency requirement (tier 2,
 * getSentenceListeningReadiness) — so the learner has parsed every content
 * word inside its clause, by both reading and ear, before being asked to
 * parse the whole clip cold.
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
 * Grammar-pattern review: subjectType `grammarPattern`, subjectId a
 * GrammarPattern.id. Was a 4-card ladder (grammar_comprehension/
 * grammar_completion/grammar_contrast/grammar_production); the other three
 * retired 2026-09-15 (docs/ROADMAP.md) — barely used, and hid the
 * pattern's explanation behind a separate self-rated card instead of
 * putting it in the one moment that actually mattered (choosing the right
 * construction). `grammar_completion` survives as the sole grammar
 * activity type, rebuilt with always-visible translation + passage
 * context (see GrammarCompletionCard). Unlike every other category above,
 * never lazily seeded by ReviewPage itself — a grammarPattern study item
 * only ever comes from an explicit "Track" in GrammarPicker
 * (src/components/GrammarPicker.tsx). `candidates` below is therefore
 * built from *already-tracked* patterns only (not "every pattern in
 * scope"). Global scope only (no bookId): a pattern isn't really "of" one
 * book the way a sentence is.
 */
const GRAMMAR_ACTIVITY_TYPES: StudyActivityType[] = ['grammar_completion'];

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
  grammar_completion: 'Grammar completion',
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
    const { vocabularyItem, sentence, surfaceForm: storedSurface } = occurrence;
    const wordClass = conjugationWordClassFromPartOfSpeech(vocabularyItem.partOfSpeech);
    if (!wordClass) continue;

    // Prefer the stored surface form when it's already a recognizable single
    // conjugation step. When it isn't, the picker often truncated it to the
    // bare stem (言っ for 言って, 思わ for 思わない) — recover the full
    // inflected word from the sentence, but only accept it when it *extends*
    // the stored surface, so a genuinely stacked/compound occurrence
    // (食べられなかった) still gets no card and a multi-occurrence word can't
    // be matched to the wrong form.
    let surfaceForm = storedSurface;
    let form: ConjugationForm;
    const identified = identifyConjugationForm(
      vocabularyItem.expression,
      vocabularyItem.reading,
      wordClass,
      storedSurface,
      surfaceReadingFromInline(sentence.inlineReading, storedSurface) ?? undefined,
    );
    if (identified) {
      form = identified.form;
    } else {
      const resolved = findInflectedSurfaceInSentence(
        sentence.japanese,
        vocabularyItem.expression,
        vocabularyItem.reading,
        wordClass,
      );
      if (
        !resolved ||
        resolved.surface === storedSurface ||
        !resolved.surface.startsWith(storedSurface)
      ) {
        continue;
      }
      surfaceForm = resolved.surface;
      form = resolved.form;
    }

    const inContextReading = surfaceReadingFromInline(sentence.inlineReading, surfaceForm);
    const engineReading = conjugate(
      vocabularyItem.expression,
      vocabularyItem.reading,
      wordClass,
      form.key,
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
      form,
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
    if (existing?.isCitationForm) continue; // already have the best possible match for this word
    const audio = audioBySentenceId.get(occurrence.sentence.id);
    if (!audio) continue;
    const result = buildPitchAccentCandidate(occurrence, audio);
    if (!result) continue;
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

interface GrammarReviewCandidate {
  pattern: GrammarPattern;
  sentence: Sentence;
  /** Passage framing for the target sentence — same shape reading_in_context uses. */
  readingContext: ReadingContext;
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

/** `${subjectType}:${subjectId}` — same key the sibling-bury filter uses. */
function queueCardSubjectKey(card: QueueCard): string {
  return `${card.studyItem.subjectType}:${card.studyItem.subjectId}`;
}

/**
 * Reorders a due queue so two cards on the same subject are never adjacent
 * unless every remaining card shares that subject (user request
 * 2026-09-04). The sibling-bury filter above only holds back `review`/
 * `relearning` siblings; a word whose reading_retrieval / cloze /
 * reading_production are all still `learning` (e.g. rated "again" every
 * sitting for days) keeps all three — and due-sorted they land adjacent,
 * so revealing the first turns the next into a short-term echo test.
 * Greedy: always take the earliest-due card whose subject differs from the
 * one just emitted; fall back to plain due order only when it can't.
 */
export function spaceOutSiblingCards(cards: QueueCard[]): QueueCard[] {
  const remaining = [...cards];
  const spaced: QueueCard[] = [];
  let lastKey: string | null = null;
  while (remaining.length > 0) {
    let index = remaining.findIndex(
      (card) => queueCardSubjectKey(card) !== lastKey,
    );
    if (index === -1) index = 0;
    const [card] = remaining.splice(index, 1);
    spaced.push(card!);
    lastKey = queueCardSubjectKey(card!);
  }
  return spaced;
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
   * every tier-1 item — and for the contrastive pair card, which waits on both
   * member words' reading proficiency. Evaluated in addition to `gateSentenceId`.
   */
  isReady?: (candidate: unknown, ctx: GateContext) => boolean;
  /**
   * Like `isReady`, but per activity type — for a descriptor whose activity
   * types don't all share the same gate. Returns false to withhold just
   * that (candidate, activityType) pair from both the due queue and
   * seeding. Used by the sentence descriptor: `reading_in_context` waits on
   * its whole passage's readiness, `comprehension` doesn't.
   */
  activityIsReady?: (
    candidate: unknown,
    activityType: StudyActivityType,
    ctx: GateContext,
  ) => boolean;
}

/** Shared inputs for ActivityDescriptor.isReady, built once per queue build. */
interface GateContext {
  /** Vocabulary item ids (in scope) whose reading/meaning study item(s) have reached FSRS proficiency — pitch_accent reps on the same subject don't count (getProficientReadingVocabularyItemIds). */
  proficientVocabularyItemIds: Set<string>;
  /** Sentence id -> every surface-form occurrence has a proficient `word_listening` item. */
  listeningReadiness: Map<string, boolean>;
  /**
   * Sentence id -> ready for full review (vocab confirmed AND every
   * surface-form vocab item FSRS-proficient — getSentenceFullReviewReadiness).
   * The same map `gateSentenceId` is checked against; exposed here so
   * `reading_in_context` can also check its passage neighbours.
   */
  sentenceReadiness: Map<string, boolean>;
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
  activityIsReady?: (
    candidate: C,
    activityType: StudyActivityType,
    ctx: GateContext,
  ) => boolean;
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
        readingContext: scope.readingContextBySentenceId.get(sentence.id),
      }),
      ensure: (sentence, activityType) => ensureStudyItem('sentence', sentence.id, activityType),
      gateSentenceId: (sentence) => sentence.id,
      // On top of gateSentenceId (the card's own sentence vocab), the
      // sentence card waits until every sentence shown in the surrounding
      // passage is itself ready for full review, so the learner never
      // studies a passage containing words they haven't confirmed + made
      // proficient yet (user request, 2026-09-03). Empty context (no book
      // membership, or a book-scoped queue that can't see the neighbours)
      // => nothing to gate on, ready.
      activityIsReady: (sentence, _activityType, ctx) => {
        const context = scope.readingContextBySentenceId.get(sentence.id);
        if (!context) return true;
        return [...context.before, ...context.after].every(
          (neighbour) => ctx.sentenceReadiness.get(neighbour.id) !== false,
        );
      },
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
      // A word with no kanji in its dictionary form has no reading to recall —
      // `reading_retrieval` / `reading_production` degenerate into copying the
      // kana already on screen (user request). `cloze` (recall which word
      // fills the blank from meaning/context) still tests something real, so
      // it's the only vocabulary-target card an all-kana word gets. Existing
      // such study items just stop surfacing; nothing is deleted, and the
      // word's proficiency still counts toward sentence readiness.
      activityIsReady: (candidate, activityType) =>
        activityType === 'cloze' || containsKanji(candidate.vocabularyItem.expression),
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
      // Vocab gate (user request, 2026-09-03): a contrastive pair is only
      // worth drilling once each side is individually known — withhold the
      // card until BOTH member words' readings have reached FSRS proficiency,
      // mirroring the tier-1 word_listening gate above.
      isReady: (candidate, ctx) =>
        ctx.proficientVocabularyItemIds.has(candidate.itemA.vocabularyItem.id) &&
        ctx.proficientVocabularyItemIds.has(candidate.itemB.vocabularyItem.id),
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
      occurrenceCandidates,
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

    // Grammar patterns: global scope only (bookId unset) — a tracked
    // pattern isn't scoped to one book the way a sentence is, and its
    // "context sentence" may come from any book it's been encountered in.
    // Candidates are built from already-tracked patterns (any existing
    // grammarPattern study item), not "every pattern in the corpus" — see
    // GRAMMAR_ACTIVITY_TYPES's doc comment.
    let grammarCandidates: GrammarReviewCandidate[] = [];
    let existingGrammarItems: StudyItem[] = [];
    if (!bookId) {
      const grammarStudyItems = (
        await db.studyItems.where('activityType').anyOf(GRAMMAR_ACTIVITY_TYPES).toArray()
      ).filter((item) => item.subjectType === 'grammarPattern');
      const trackedPatternIds = [...new Set(grammarStudyItems.map((item) => item.subjectId))];
      if (trackedPatternIds.length > 0) {
        const trackedPatterns = await db.grammarPatterns.bulkGet(trackedPatternIds);
        for (const pattern of trackedPatterns) {
          if (!pattern) continue;
          const context = await pickContextSentenceForGrammarPattern(pattern.id);
          if (!context) continue;
          grammarCandidates.push({
            pattern,
            sentence: context.sentence,
            readingContext: context.readingContext,
          });
        }
        const grammarCandidateIds = new Set(grammarCandidates.map((c) => c.pattern.id));
        existingGrammarItems = grammarStudyItems.filter((item) =>
          grammarCandidateIds.has(item.subjectId),
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
      // reading_in_context study_item yet would otherwise bypass it
      // entirely via lazy seeding below — sentenceReadiness covers that path.
      await deferUnreadySentenceReviews(SENTENCE_ACTIVITY_TYPES);
      // reading_in_context also waits on its passage neighbours' vocab, on
      // top of its own sentence. deferUnreadySentenceReviews above only
      // checked each card's own target sentence; this pushes out any
      // already-due reading_in_context item whose surrounding passage isn't
      // ready yet (the isGatedOut filter below covers the not-yet-seeded
      // path, same split as the sentence gate).
      await deferUnreadyReadingInContextReviews();
      // Same gate for tracked grammar patterns: a grammarPattern-subject card
      // (comprehension/completion/contrast/production) whose pattern has no
      // full-review-ready linked sentence is dropped from the queue below
      // anyway (pickContextSentenceForGrammarPattern → undefined) — push its
      // stored due date out too so it stops counting as due backlog.
      await deferUnreadyGrammarReviews();
      const sentenceIds = scope.sentences.map((sentence) => sentence.id);
      const sentenceReadiness = await getSentenceFullReviewReadiness(sentenceIds);

      // Per-candidate gates (ActivityDescriptor.isReady). Listening ladder:
      // tier 1 (word_listening) waits on the word's reading proficiency; tier 2
      // (listening) waits on every tier-1 item. Contrastive pair: waits on both
      // member words' reading proficiency. Like the conjugation card, these have
      // no defer pass of their own — the isGatedOut filter below keeps them out
      // of the queue and the pending-seed pool.
      const gateContext: GateContext = {
        proficientVocabularyItemIds: await getProficientReadingVocabularyItemIds([
          ...new Set([
            ...scope.wordListeningCandidates.map((candidate) => candidate.vocabularyItem.id),
            // Contrastive pair members are gated on their own reading
            // proficiency too (see the `confusion` descriptor's isReady) — their
            // ids must be in this set or every contrastive card is gated out.
            ...scope.confusionPairCandidates.flatMap((candidate) => [
              candidate.itemA.vocabularyItem.id,
              candidate.itemB.vocabularyItem.id,
            ]),
          ]),
        ]),
        listeningReadiness: await getSentenceListeningReadiness(sentenceIds),
        sentenceReadiness,
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
      const isGatedOut = (
        descriptor: ActivityDescriptor,
        candidate: unknown,
        activityType?: StudyActivityType,
      ): boolean => {
        const gateSentenceId = descriptor.gateSentenceId?.(candidate);
        if (!!gateSentenceId && sentenceReadiness.get(gateSentenceId) === false) return true;
        if (descriptor.isReady && !descriptor.isReady(candidate, gateContext)) return true;
        if (
          activityType &&
          descriptor.activityIsReady &&
          !descriptor.activityIsReady(candidate, activityType, gateContext)
        ) {
          return true;
        }
        return false;
      };

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
      // Any siblings that survived the bury filter (still `new`/`learning`)
      // get spread apart so they aren't shown back to back.
      const spaced = spaceOutSiblingCards(deduped);

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

      if (cancelled) return;
      setQueue(spaced);
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
        assistance: assistanceUsed.size > 0 ? [...assistanceUsed] : undefined,
        responseRaw: typedResponse || undefined,
        expectedAnswer: typedResponse ? expectedAnswerValue : undefined,
        pitchExpectedShape: pitchAccentShapes?.pitchExpectedShape,
        pitchChosenShape: pitchAccentShapes?.pitchChosenShape,
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
            ) : current.grammar ? (
              <GrammarCompletionCard
                key={current.studyItem.id}
                candidate={current.grammar}
                revealed={revealed}
                onCheck={(value, gradedAgainst) => {
                  setTypedResponse(value);
                  setTypedResponseExpected(gradedAgainst);
                  setRevealed(true);
                }}
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
            {revealed && (current.audio ?? current.wordListening?.audio) ? (
              // Measured pitch of the native clip — directly under the
              // sentence, above the dictionary H/L row. Only on the
              // audio-centric cards (listening / word_listening).
              <ReviewPitchContour audio={(current.audio ?? current.wordListening?.audio)!} />
            ) : null}
            {revealed && current.studyItem.activityType !== 'pitch_accent' ? (
              // Ambient pitch-accent contour for the sentence under review.
              // `pitch_accent` renders its own (target-highlighted) copy.
              // `sentence_transformation`'s own inflected verb is included
              // here now too — getSentencePitchAccentTargets resolves each
              // occurrence's real conjugated contour via
              // resolveInflectedPitchAccent, dropping (not misdrawing) any
              // occurrence outside that resolver's narrow coverage.
              <>
                {!(current.audio ?? current.wordListening?.audio) ? (
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
 * `reading_in_context` card body — the sole sentence-subject card. Reveal
 * flow: see JP, reveal EN + vocab, self-rate. The sentence under test is
 * framed by its reading-order neighbours (buildReadingContextMap): the
 * preceding sentences are shown untranslated above it so the passage sets
 * the scene without spoiling the answer, and the following sentence's
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
  const { vocabularyItem, sentence, surfaceForm, audio, reading, morae, correctPosition, correctLabel } =
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
      <div className="jp">{reading}</div>

      <PitchAccentNativeAudio
        audio={audio}
        japanese={sentence.japanese}
        surfaceForm={surfaceForm}
        link={candidate.link}
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
      <MeasuredPitchContour payload={payload} progress={progress} />
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
  return <ReviewPitchContour audio={audio} />;
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
  const { sentence, audio, surfaceForm, vocabularyItem, link } = candidate;
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
            link={link}
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
 * Grammar completion — the sole grammar review card since
 * `grammar_comprehension`/`grammar_contrast`/`grammar_production` were
 * retired 2026-09-15 (docs/ROADMAP.md): a prior redesign collapsed all
 * four into an ambient notice strip under every review card, which in
 * real use "makes the review cards clunky and doesn't help with learning"
 * (user). The target sentence's English translation is always visible —
 * it's the input signal for producing the right construct, the same idea
 * as giving the audio in a pitch-accent card and asking for the pitch
 * shape — and the sentence is framed by its reading-order passage
 * context, same convention as ReadingInContextCard (before shown
 * untranslated always; after shown untranslated pre-reveal, translated
 * post-reveal). Blanks the pattern's surface form when it appears
 * verbatim in the sentence (blankPatternInSentence — best-effort, no real
 * span data exists yet); otherwise shows the full sentence and asks which
 * construction it uses.
 *
 * **2026-09-17 redesign** (card issue triage — "not sure if the way this
 * card type is setup is helpful, it's just kind of a search and find"):
 * was multiple choice among the pattern and up to 3 distractors. Given the
 * translation is already shown, a learner can eliminate options by
 * grammatical shape alone without ever recalling the construct from its
 * meaning — the complaint was exactly that shortcut. Replaced with a
 * typed answer, same shape as SentenceConjugationCard/ReadingProductionCard:
 * the learner types the construction, graded leniently via
 * `isGrammarPatternAnswerCorrect` (tilde/annotation/whitespace-insensitive,
 * same normalization `blankPatternInSentence` and pattern dedup already
 * use). This also means every tracked pattern gets the same card shape now,
 * even a lone pattern with nothing to contrast against — there's no longer
 * a "not enough distractors" degenerate case to special-case.
 * `buildGrammarCompletionChoices`/`GRAMMAR_COMPLETION_CHOICE_COUNT` and the
 * GrammarRelationship-ranked-distractor logic this replaced are gone from
 * `grammarPatterns.ts` (git history/docs/ROADMAP.md's "grammar pattern
 * discrimination" entry has the distractor-ranking approach if a future
 * card wants it back). Still auto-graded, still funnels through the same
 * typed-response/self-rate flow every other typed card uses. Reveals the
 * pattern's own explanation — the only place that used to surface on the
 * retired `grammar_comprehension`, so it must not be lost here.
 */
function GrammarCompletionCard({
  candidate,
  revealed,
  onCheck,
}: {
  candidate: GrammarReviewCandidate;
  revealed: boolean;
  onCheck: (typed: string, gradedAgainst: string) => void;
}) {
  const { pattern, sentence, readingContext } = candidate;
  const [value, setValue] = useState('');
  const [wasCorrect, setWasCorrect] = useState(false);
  const blank = blankPatternInSentence(sentence.japanese, pattern.canonicalName);
  const { before, after } = readingContext;

  const explanation = (
    <>
      {pattern.shortMeaning ? <div>{pattern.shortMeaning}</div> : null}
      {pattern.explanation ? <div className="muted">{pattern.explanation}</div> : null}
      {pattern.structuralNotes ? (
        <div className="muted">{pattern.structuralNotes}</div>
      ) : null}
    </>
  );

  const passageBefore = readingContext.bookTitle ? (
    <>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        In context · {readingContext.bookTitle}
      </p>
      {before.length ? (
        <div className="reading-context">
          {before.map((item) => (
            <p key={item.id} className="jp jp-sm reading-context-line">
              {item.japanese}
            </p>
          ))}
        </div>
      ) : null}
    </>
  ) : null;

  const passageAfter = after.length ? (
    <div className="reading-context">
      {after.map((item) => (
        <p key={item.id} className="reading-context-line">
          <span className="jp jp-sm">{item.japanese}</span>
          {item.translation ? <span className="muted"> — {item.translation}</span> : null}
        </p>
      ))}
    </div>
  ) : null;

  return (
    <>
      {passageBefore}
      <div className="jp jp-lg">
        {blank ? (
          <>
            {blank.before}
            <mark>{revealed ? pattern.canonicalName : '_____'}</mark>
            {blank.after}
          </>
        ) : (
          sentence.japanese
        )}
      </div>
      {sentence.translation ? <div className="muted">{sentence.translation}</div> : null}
      {!revealed ? (
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            setWasCorrect(isGrammarPatternAnswerCorrect(value, pattern.canonicalName));
            onCheck(value, pattern.canonicalName);
          }}
        >
          <label>
            {blank
              ? 'What construction fills the blank?'
              : 'Which construction does this sentence use?'}
            <input
              type="text"
              className="jp"
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
          <div className="muted">
            Correct: <span className="jp">{pattern.canonicalName}</span>
          </div>
          {explanation}
          {passageAfter}
        </>
      )}
    </>
  );
}
