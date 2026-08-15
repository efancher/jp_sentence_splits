import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { NativeAudioButton } from '../components/NativeAudioButton';
import { VocabChips } from '../components/VocabChips';
import {
  ensureStudyItem,
  ensureVocabularyStudyItem,
  getDb,
  getDueStudyItems,
  getVocabularyTargetCandidates,
  recordReview,
  type VocabularyTargetCandidate,
} from '../db/repository';
import type {
  ReviewRating,
  Sentence,
  SentenceAudio,
  StudyActivityType,
  StudyItem,
  VocabularyItem,
} from '../domain/types';

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
 * Vocabulary-item-subject activity types (Phase 7.2/7.3, docs/STATUS.md) —
 * both target a specific occurrence of a word in one of its sentences, and
 * so share one eligibility condition and candidate source (see
 * getVocabularyTargetCandidates): a surfaceForm-bearing sentence_vocabulary
 * link. Vocabulary confirmed before that field existed, or imported outside
 * the picker, isn't a candidate for either yet. `reading_retrieval` shows
 * the word (hides the reading); `cloze` hides the word entirely.
 */
const VOCABULARY_ACTIVITY_TYPES: StudyActivityType[] = [
  'reading_retrieval',
  'cloze',
];

/**
 * Audio comprehension (Phase 7.4, docs/STATUS.md) — sentence-subject, like
 * `comprehension`/`reading_in_context`, but only eligible for sentences
 * that have at least one `SentenceAudio` row; the Japanese text stays
 * hidden until reveal, audio plays first.
 */
const AUDIO_ACTIVITY_TYPES: StudyActivityType[] = ['listening'];

const ACTIVITY_LABELS: Record<string, string> = {
  comprehension: 'Comprehension',
  reading_in_context: 'Reading in context',
  reading_retrieval: 'Reading retrieval',
  cloze: 'Cloze',
  listening: 'Listening',
};

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
    };

function pendingSeedKey(seed: PendingSeed): string {
  if (seed.kind === 'vocabulary') return seed.candidate.vocabularyItem.id;
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

    return {
      book,
      sentences,
      existingSentenceItems,
      vocabularyTargetCandidates,
      existingVocabularyItems,
      audioBySentenceId,
      existingAudioItems,
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

      const [dueSentenceItems, dueVocabularyItems, dueAudioItems] = await Promise.all([
        getDueStudyItems(SENTENCE_ACTIVITY_TYPES, {
          subjectIds: scope.sentences.map((item) => item.id),
        }),
        getDueStudyItems(VOCABULARY_ACTIVITY_TYPES, {
          subjectIds: [...byVocabularyItemId.keys()],
        }),
        getDueStudyItems(AUDIO_ACTIVITY_TYPES, {
          subjectIds: [...scope.audioBySentenceId.keys()],
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

      const due = [...dueSentenceCards, ...dueVocabularyCards, ...dueAudioCards].sort(
        (a, b) => a.studyItem.fsrsState.due.localeCompare(b.studyItem.fsrsState.due),
      );

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
  }, [current?.studyItem.id]);

  async function handleRate(rating: ReviewRating) {
    if (!current || submitting) return;
    setSubmitting(true);
    try {
      await recordReview({ studyItemId: current.studyItem.id, rating });
      setQueue((q) => q.slice(1));
    } finally {
      setSubmitting(false);
    }
  }

  if (bookId && scope === undefined) return <p className="muted">Loading…</p>;
  if (!initialized) return <p className="muted">Loading…</p>;

  const totalScopedSubjects =
    (scope?.sentences.length ?? 0) + (scope?.vocabularyTargetCandidates.length ?? 0);
  const nextDue = [
    ...(scope?.existingSentenceItems ?? []),
    ...(scope?.existingVocabularyItems ?? []),
    ...(scope?.existingAudioItems ?? []),
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
            {current.target ? (
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
                sentence={current.sentence}
                audio={current.audio}
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
  return (
    <>
      <div className="jp jp-lg">
        {before}
        <mark>{isCloze && !revealed ? '_____' : target || surfaceForm}</mark>
        {after}
      </div>
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
}: {
  sentence: Sentence;
  audio: SentenceAudio;
  revealed: boolean;
  onReveal: () => void;
}) {
  return (
    <>
      <NativeAudioButton audio={audio} displayLabel="Play audio" />
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
