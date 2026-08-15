import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { VocabChips } from '../components/VocabChips';
import { ensureStudyItem, getDb, getDueStudyItems, recordReview } from '../db/repository';
import type { ReviewRating, Sentence, StudyActivityType, StudyItem } from '../domain/types';

/**
 * Phase 4 (docs/UNIFIED_APP_ARCHITECTURE.md §10) starts with two activity
 * types sharing one interaction (see JP, reveal EN + vocab, self-rate) —
 * real differentiation between them (e.g. showing surrounding chapter
 * context for reading_in_context) is deliberately deferred, see STATUS.md.
 */
const REVIEW_ACTIVITY_TYPES: StudyActivityType[] = [
  'comprehension',
  'reading_in_context',
];

const ACTIVITY_LABELS: Record<string, string> = {
  comprehension: 'Comprehension',
  reading_in_context: 'Reading in context',
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
}

/** A (sentence, activityType) pair with no study_item yet — needs seeding. */
interface PendingSeed {
  sentence: Sentence;
  activityType: StudyActivityType;
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
    const sentenceIds = new Set(sentences.map((item) => item.id));
    const existingItems = (
      await db.studyItems.where('activityType').anyOf(REVIEW_ACTIVITY_TYPES).toArray()
    ).filter(
      (item) => item.subjectType === 'sentence' && sentenceIds.has(item.subjectId),
    );
    return { book, sentences, existingItems };
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
      const dueItems = await getDueStudyItems(REVIEW_ACTIVITY_TYPES, {
        subjectIds: scope.sentences.map((item) => item.id),
      });
      const due = dueItems
        .map((studyItem) => {
          const sentence = bySentenceId.get(studyItem.subjectId);
          return sentence ? { studyItem, sentence } : null;
        })
        .filter((card): card is QueueCard => Boolean(card));

      // Any (sentence, activityType) pair with no study_item yet needs
      // seeding — tracked per-pair (not per-sentence) so a sentence left
      // with only some activity types seeded still gets the rest.
      const existingKeys = new Set(
        scope.existingItems.map((item) => `${item.subjectId}:${item.activityType}`),
      );
      const pendingSeeds: PendingSeed[] = [];
      for (const sentence of scope.sentences) {
        for (const activityType of REVIEW_ACTIVITY_TYPES) {
          if (!existingKeys.has(`${sentence.id}:${activityType}`)) {
            pendingSeeds.push({ sentence, activityType });
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

  // Lazily seed study_items for the next never-reviewed sentence once the
  // due queue runs dry (confirmed with the user — no batch seeding step).
  useEffect(() => {
    if (!initialized || queue.length > 0 || pool.length === 0 || seeding) return;
    const sentenceId = pool[0]!.sentence.id;
    const batch = pool.filter((item) => item.sentence.id === sentenceId);
    setSeeding(true);
    void (async () => {
      const items = await Promise.all(
        batch.map((item) =>
          ensureStudyItem('sentence', item.sentence.id, item.activityType),
        ),
      );
      setPool((current) => current.filter((item) => item.sentence.id !== sentenceId));
      setQueue(
        items.map((studyItem, index) => ({
          studyItem,
          sentence: batch[index]!.sentence,
        })),
      );
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

  const nextDue = scope?.existingItems
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

        {scope && scope.sentences.length === 0 ? (
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
            <div className="jp jp-lg">{current.sentence.japanese}</div>
            {!revealed ? (
              <button type="button" onClick={() => setRevealed(true)}>
                Reveal
              </button>
            ) : (
              <>
                <div>{current.sentence.translation || '(no translation)'}</div>
                <VocabChips items={current.sentence.targetVocabulary} />
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
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
