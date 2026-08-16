import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { NativeAudioButton } from '../components/NativeAudioButton';
import { VocabChips } from '../components/VocabChips';
import {
  computeVocabularyContextDiversity,
  ensureStudyItem,
  ensureVocabularyStudyItem,
  getConfusionPairCandidates,
  getDb,
  getDueStudyItems,
  getVocabularyTargetCandidates,
  recordReview,
  type ConfusionPairCandidate,
  type VocabularyTargetCandidate,
} from '../db/repository';
import type {
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
  type ConjugatedForm,
  type ConjugationWordClass,
} from '../lib/conjugation';
import { computeMaturityLevel, MATURE_MIN_SCHEDULED_DAYS } from '../lib/maturity';
import { normalizeSentenceKey } from '../lib/normalize';

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
 * conjugated form actually differs from the dictionary form. Fixed to a
 * single form (plain past) for this first slice — see
 * getSentenceTransformationCandidates — rather than cycling through all 13
 * verb/10 adjective forms, matching every prior phase's "start small"
 * precedent.
 */
const TRANSFORMATION_ACTIVITY_TYPES: StudyActivityType[] = ['sentence_transformation'];
const TRANSFORMATION_FORM_KEY = 'plain_past';
const TRANSFORMATION_FORM_LABEL = 'Plain past';

const ACTIVITY_LABELS: Record<string, string> = {
  comprehension: 'Comprehension',
  reading_in_context: 'Reading in context',
  reading_retrieval: 'Reading retrieval',
  cloze: 'Cloze',
  reading_production: 'Reading production',
  listening: 'Listening',
  contrastive: 'Contrastive pair',
  sentence_transformation: 'Sentence transformation',
};

interface SentenceTransformationCandidate {
  vocabularyItem: VocabularyItem;
  sentence: Sentence;
  surfaceForm: string;
  wordClass: ConjugationWordClass;
  target: ConjugatedForm;
}

/**
 * Pure filter over already-fetched vocabulary-target candidates (no DB
 * access needed, unlike getConfusionPairCandidates) — a word is a
 * candidate only if its partOfSpeech is conjugable and conjugating it to
 * TRANSFORMATION_FORM_KEY actually produces something different from the
 * dictionary form (skips e.g. a word whose plain-past happens to equal its
 * dictionary form, or one conjugate() can't handle at all).
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
    const target = conjugate(
      candidate.vocabularyItem.expression,
      candidate.vocabularyItem.reading,
      wordClass,
      TRANSFORMATION_FORM_KEY,
    );
    if (!target) continue;
    if (
      target.expression === candidate.vocabularyItem.expression &&
      target.reading === candidate.vocabularyItem.reading
    ) {
      continue;
    }
    result.push({ ...candidate, wordClass, target });
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
}

/** A (subject, activityType) pair with no study_item yet — needs seeding. */
type PendingSeed =
  | { kind: 'sentence'; sentence: Sentence; activityType: StudyActivityType }
  | {
      kind: 'vocabulary';
      candidate: VocabularyTargetCandidate;
      activityType: StudyActivityType;
    }
  | {
      kind: 'listening';
      sentence: Sentence;
      audio: SentenceAudio;
      activityType: StudyActivityType;
    }
  | {
      kind: 'confusion';
      candidate: ConfusionPairCandidate;
      activityType: StudyActivityType;
    }
  | {
      kind: 'transformation';
      candidate: SentenceTransformationCandidate;
      activityType: StudyActivityType;
    };

function pendingSeedKey(seed: PendingSeed): string {
  if (seed.kind === 'vocabulary' || seed.kind === 'transformation') {
    return seed.candidate.vocabularyItem.id;
  }
  if (seed.kind === 'confusion') return seed.candidate.confusion.id;
  return seed.sentence.id;
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

export function ReviewPage() {
  const { bookId } = useParams();
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

  const scope = useLiveQuery(async () => {
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

    return {
      book,
      sentences,
      existingSentenceItems,
      vocabularyTargetCandidates,
      existingVocabularyItems,
      audioBySentenceId,
      existingAudioItems,
      confusionPairCandidates,
      existingConfusionItems,
      sentenceTransformationCandidates,
      existingTransformationItems,
    };
  }, [bookId]);

  // Build the session queue once, the first time scope data arrives —
  // re-running this on every live-query tick would reshuffle the queue out
  // from under the user mid-session as recordReview() updates studyItems.
  // Due-ness is delegated to getDueStudyItems so this stays the single
  // source of truth for "due" semantics (not reimplemented here too).
  useEffect(() => {
    if (!scope || initialized) return;
    let cancelled = false;
    void (async () => {
      const bySentenceId = new Map(scope.sentences.map((item) => [item.id, item]));
      const byVocabularyItemId = new Map(
        scope.vocabularyTargetCandidates.map((candidate) => [
          candidate.vocabularyItem.id,
          candidate,
        ]),
      );

      const byConfusionId = new Map(
        scope.confusionPairCandidates.map((candidate) => [candidate.confusion.id, candidate]),
      );
      const byTransformationVocabularyItemId = new Map(
        scope.sentenceTransformationCandidates.map((candidate) => [
          candidate.vocabularyItem.id,
          candidate,
        ]),
      );

      const [
        dueSentenceItems,
        dueVocabularyItems,
        dueAudioItems,
        dueConfusionItems,
        dueTransformationItems,
      ] = await Promise.all([
        getDueStudyItems(SENTENCE_ACTIVITY_TYPES, {
          subjectIds: scope.sentences.map((item) => item.id),
        }),
        getDueStudyItems(VOCABULARY_ACTIVITY_TYPES, {
          subjectIds: [...byVocabularyItemId.keys()],
        }),
        getDueStudyItems(AUDIO_ACTIVITY_TYPES, {
          subjectIds: [...scope.audioBySentenceId.keys()],
        }),
        getDueStudyItems(CONFUSION_ACTIVITY_TYPES, {
          subjectIds: [...byConfusionId.keys()],
        }),
        getDueStudyItems(TRANSFORMATION_ACTIVITY_TYPES, {
          subjectIds: [...byTransformationVocabularyItemId.keys()],
        }),
      ]);

      const dueSentenceCards = dueSentenceItems
        .map((studyItem): QueueCard | null => {
          const sentence = bySentenceId.get(studyItem.subjectId);
          return sentence ? { studyItem, sentence } : null;
        })
        .filter((card): card is QueueCard => card !== null);

      const dueVocabularyCards = dueVocabularyItems
        .map((studyItem): QueueCard | null => {
          const candidate = byVocabularyItemId.get(studyItem.subjectId);
          return candidate
            ? {
                studyItem,
                sentence: candidate.sentence,
                target: {
                  vocabularyItem: candidate.vocabularyItem,
                  surfaceForm: candidate.surfaceForm,
                },
              }
            : null;
        })
        .filter((card): card is QueueCard => card !== null);

      const dueAudioCards = dueAudioItems
        .map((studyItem): QueueCard | null => {
          const sentence = bySentenceId.get(studyItem.subjectId);
          const audio = scope.audioBySentenceId.get(studyItem.subjectId);
          return sentence && audio ? { studyItem, sentence, audio } : null;
        })
        .filter((card): card is QueueCard => card !== null);

      const dueConfusionCards = dueConfusionItems
        .map((studyItem): QueueCard | null => {
          const candidate = byConfusionId.get(studyItem.subjectId);
          return candidate
            ? { studyItem, sentence: candidate.itemA.sentence, confusionPair: candidate }
            : null;
        })
        .filter((card): card is QueueCard => card !== null);

      const dueTransformationCards = dueTransformationItems
        .map((studyItem): QueueCard | null => {
          const candidate = byTransformationVocabularyItemId.get(studyItem.subjectId);
          return candidate
            ? { studyItem, sentence: candidate.sentence, transformation: candidate }
            : null;
        })
        .filter((card): card is QueueCard => card !== null);

      const due = [
        ...dueSentenceCards,
        ...dueVocabularyCards,
        ...dueAudioCards,
        ...dueConfusionCards,
        ...dueTransformationCards,
      ].sort((a, b) => a.studyItem.fsrsState.due.localeCompare(b.studyItem.fsrsState.due));

      // Any (subject, activityType) pair with no study_item yet needs
      // seeding — tracked per-pair (not per-subject) so a subject left with
      // only some activity types seeded still gets the rest.
      const existingSentenceKeys = new Set(
        scope.existingSentenceItems.map(
          (item) => `${item.subjectId}:${item.activityType}`,
        ),
      );
      const pendingSeeds: PendingSeed[] = [];
      for (const sentence of scope.sentences) {
        for (const activityType of SENTENCE_ACTIVITY_TYPES) {
          if (!existingSentenceKeys.has(`${sentence.id}:${activityType}`)) {
            pendingSeeds.push({ kind: 'sentence', sentence, activityType });
          }
        }
      }
      const existingVocabularyKeys = new Set(
        scope.existingVocabularyItems.map(
          (item) => `${item.subjectId}:${item.activityType}`,
        ),
      );
      for (const candidate of scope.vocabularyTargetCandidates) {
        for (const activityType of VOCABULARY_ACTIVITY_TYPES) {
          if (
            !existingVocabularyKeys.has(
              `${candidate.vocabularyItem.id}:${activityType}`,
            )
          ) {
            pendingSeeds.push({ kind: 'vocabulary', candidate, activityType });
          }
        }
      }
      const existingAudioKeys = new Set(
        scope.existingAudioItems.map(
          (item) => `${item.subjectId}:${item.activityType}`,
        ),
      );
      for (const [sentenceId, audio] of scope.audioBySentenceId) {
        const sentence = bySentenceId.get(sentenceId);
        if (!sentence) continue;
        for (const activityType of AUDIO_ACTIVITY_TYPES) {
          if (!existingAudioKeys.has(`${sentenceId}:${activityType}`)) {
            pendingSeeds.push({ kind: 'listening', sentence, audio, activityType });
          }
        }
      }
      const existingConfusionKeys = new Set(
        scope.existingConfusionItems.map(
          (item) => `${item.subjectId}:${item.activityType}`,
        ),
      );
      for (const candidate of scope.confusionPairCandidates) {
        for (const activityType of CONFUSION_ACTIVITY_TYPES) {
          if (!existingConfusionKeys.has(`${candidate.confusion.id}:${activityType}`)) {
            pendingSeeds.push({ kind: 'confusion', candidate, activityType });
          }
        }
      }
      const existingTransformationKeys = new Set(
        scope.existingTransformationItems.map(
          (item) => `${item.subjectId}:${item.activityType}`,
        ),
      );
      for (const candidate of scope.sentenceTransformationCandidates) {
        for (const activityType of TRANSFORMATION_ACTIVITY_TYPES) {
          if (
            !existingTransformationKeys.has(`${candidate.vocabularyItem.id}:${activityType}`)
          ) {
            pendingSeeds.push({ kind: 'transformation', candidate, activityType });
          }
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
  }, [scope, initialized]);

  // Lazily seed study_items for the next never-reviewed subject once the
  // due queue runs dry (confirmed with the user — no batch seeding step).
  useEffect(() => {
    if (!initialized || queue.length > 0 || pool.length === 0 || seeding) return;
    const first = pool[0]!;
    const batchKey = pendingSeedKey(first);
    const batch = pool.filter(
      (item) => item.kind === first.kind && pendingSeedKey(item) === batchKey,
    );
    setSeeding(true);
    void (async () => {
      const cards = await Promise.all(
        batch.map(async (item): Promise<QueueCard> => {
          if (item.kind === 'sentence' || item.kind === 'listening') {
            const studyItem = await ensureStudyItem(
              'sentence',
              item.sentence.id,
              item.activityType,
            );
            return item.kind === 'listening'
              ? { studyItem, sentence: item.sentence, audio: item.audio }
              : { studyItem, sentence: item.sentence };
          }
          if (item.kind === 'confusion') {
            const studyItem = await ensureStudyItem(
              'vocabularyConfusion',
              item.candidate.confusion.id,
              item.activityType,
            );
            return {
              studyItem,
              sentence: item.candidate.itemA.sentence,
              confusionPair: item.candidate,
            };
          }
          if (item.kind === 'transformation') {
            const studyItem = await ensureVocabularyStudyItem(
              item.candidate.vocabularyItem.id,
              item.activityType,
            );
            return {
              studyItem,
              sentence: item.candidate.sentence,
              transformation: item.candidate,
            };
          }
          const studyItem = await ensureVocabularyStudyItem(
            item.candidate.vocabularyItem.id,
            item.activityType,
          );
          return {
            studyItem,
            sentence: item.candidate.sentence,
            target: {
              vocabularyItem: item.candidate.vocabularyItem,
              surfaceForm: item.candidate.surfaceForm,
            },
          };
        }),
      );
      setPool((current) =>
        current.filter(
          (item) => !(item.kind === first.kind && pendingSeedKey(item) === batchKey),
        ),
      );
      setQueue(cards);
      setSeeding(false);
    })();
  }, [initialized, queue.length, pool, seeding]);

  const current = queue[0];

  useEffect(() => {
    setRevealed(false);
    setMnemonicVisible(false);
    setAssistanceUsed(new Set());
    setTypedResponse('');
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
      const expectedReading = current.transformation
        ? current.transformation.target.reading
        : current.target?.vocabularyItem.reading;
      await recordReview({
        studyItemId: current.studyItem.id,
        rating,
        assistance: assistanceUsed.size > 0 ? [...assistanceUsed] : undefined,
        responseRaw: typedResponse || undefined,
        expectedAnswer: typedResponse ? expectedReading : undefined,
      });
      setQueue((q) => q.slice(1));
    } finally {
      setSubmitting(false);
    }
  }

  if (bookId && scope === undefined) return <p className="muted">Loading…</p>;
  if (!initialized) return <p className="muted">Loading…</p>;

  const totalScopedSubjects =
    (scope?.sentences.length ?? 0) +
    (scope?.vocabularyTargetCandidates.length ?? 0) +
    (scope?.confusionPairCandidates.length ?? 0) +
    (scope?.sentenceTransformationCandidates.length ?? 0);
  const nextDue = [
    ...(scope?.existingSentenceItems ?? []),
    ...(scope?.existingVocabularyItems ?? []),
    ...(scope?.existingAudioItems ?? []),
    ...(scope?.existingConfusionItems ?? []),
    ...(scope?.existingTransformationItems ?? []),
  ]
    .filter((item) => item.fsrsState.due > new Date().toISOString())
    .sort((a, b) => a.fsrsState.due.localeCompare(b.fsrsState.due))[0]?.fsrsState.due;

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

        {scope && totalScopedSubjects === 0 ? (
          <p className="muted">No sentences to review here yet.</p>
        ) : seeding ? (
          <p className="muted">Loading next card…</p>
        ) : !current ? (
          <div className="empty-state">
            <strong>All caught up.</strong>
            <span className="muted">
              {nextDue
                ? `Next review due ${new Date(nextDue).toLocaleString()}.`
                : 'Nothing due right now.'}
            </span>
          </div>
        ) : (
          <>
            <div className="muted">
              {ACTIVITY_LABELS[current.studyItem.activityType] ??
                current.studyItem.activityType}{' '}
              · {queue.length} due
            </div>
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
                sentence={current.sentence}
                audio={current.audio}
                revealed={revealed}
                onReveal={() => setRevealed(true)}
                onReplay={() => markAssistance('audio_replayed')}
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
 * reading, the learner has to produce a specific conjugated form (fixed to
 * TRANSFORMATION_FORM_KEY, "plain past," for this slice). Same typed-input
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
  const { vocabularyItem, sentence, surfaceForm, target } = candidate;
  const [before, dictionaryForm, after] = splitOnSurfaceForm(sentence.japanese, surfaceForm);

  return (
    <>
      <div className="jp jp-lg">
        {before}
        <mark>{dictionaryForm || surfaceForm}</mark>
        {after}
      </div>
      <div className="muted">Conjugate to: {TRANSFORMATION_FORM_LABEL}</div>
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

/**
 * Audio comprehension (Phase 7.4, docs brief §5D): audio plays first with
 * the Japanese text hidden; reveal shows the sentence, translation, and
 * vocabulary together, same as the plain comprehension flow. The audio
 * button stays available (and replayable) both before and after reveal.
 */
function AudioComprehensionCard({
  sentence,
  audio,
  revealed,
  onReveal,
  onReplay,
}: {
  sentence: Sentence;
  audio: SentenceAudio;
  revealed: boolean;
  onReveal: () => void;
  /** Called on every play *after* the first — the first play is the exercise itself, not assistance. */
  onReplay: () => void;
}) {
  const playCountRef = useRef(0);
  return (
    <>
      <NativeAudioButton
        audio={audio}
        displayLabel="Play audio"
        onPlay={() => {
          playCountRef.current += 1;
          if (playCountRef.current > 1) onReplay();
        }}
      />
      {!revealed ? (
        <button type="button" onClick={onReveal}>
          Reveal
        </button>
      ) : (
        <>
          <div className="jp jp-lg">{sentence.japanese}</div>
          <div>{sentence.translation || '(no translation)'}</div>
          <VocabChips items={sentence.targetVocabulary} />
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
