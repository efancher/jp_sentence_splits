import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { NativeAudioButton } from '../components/NativeAudioButton';
import { SpeakButton } from '../components/SpeakButton';
import { VocabChips } from '../components/VocabChips';
import { VocabularyPicker } from '../components/VocabularyPicker';
import { confirmSentenceVocabulary, getDb, saveAnalysis } from '../db/repository';
import type { VocabularyReviewStatus, VocabularySelection } from '../domain/types';
import { defaultSelectionsFromSuggestions } from '../lib/vocabularySuggestions';
import { useActiveSession } from '../hooks/useActiveSession';
import { useAutosave } from '../hooks/useAutosave';
import { useSessionAdvance } from '../hooks/useSessionAdvance';

/**
 * Standalone vocabulary-extraction workflow for one sentence, split out of
 * AnalyzePage so the Learning Orchestrator can sequence it as its own
 * session step (`vocabulary_review`), independently completable from the
 * sentence's structural (Cure Dolly chunk) analysis. Shares the same
 * book/sentence navigation and native-audio playback as AnalyzePage, but
 * intentionally does not touch chunks/notes — those stay on AnalyzePage.
 */
export function VocabularyReviewPage() {
  const { bookId = '', sentenceId = '' } = useParams();
  const navigate = useNavigate();
  const activeSession = useActiveSession();
  const advanceToSessionStep = useSessionAdvance();
  const [selections, setSelections] = useState<VocabularySelection[]>([]);
  const [reviewStatus, setReviewStatus] =
    useState<VocabularyReviewStatus>('unreviewed');
  const [hydrated, setHydrated] = useState(false);

  const data = useLiveQuery(async () => {
    const db = getDb();
    const book = await db.books.get(bookId);
    const memberships = await db.bookSentences
      .where('bookId')
      .equals(bookId)
      .sortBy('position');
    const index = memberships.findIndex((item) => item.sentenceId === sentenceId);
    const sentence = await db.sentences.get(sentenceId);
    const analysis = await db.analyses.get(sentenceId);
    const sentenceAudio = await db.sentenceAudio
      .where('sentenceId')
      .equals(sentenceId)
      .toArray();
    return { book, memberships, index, sentence, analysis, sentenceAudio };
  }, [bookId, sentenceId]);

  useEffect(() => {
    if (!data?.sentence) return;
    setHydrated(false);
    const suggestions = data.sentence.vocabularySuggestions ?? [];
    const savedSelections = data.analysis?.vocabularySelections ?? [];
    const savedStatus = data.analysis?.vocabularyReviewStatus ?? 'unreviewed';
    if (savedStatus === 'confirmed' || savedSelections.length) {
      setSelections(savedSelections);
      setReviewStatus(savedStatus);
    } else {
      setSelections(
        defaultSelectionsFromSuggestions(suggestions, data.sentence.japanese),
      );
      setReviewStatus('unreviewed');
    }
    setHydrated(true);
    // Re-hydrate only when navigating to a different sentence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.sentence?.id]);

  const { saveState } = useAutosave(
    { selections, reviewStatus },
    async (value) => {
      const existing = await getDb().analyses.get(sentenceId);
      await saveAnalysis(sentenceId, existing?.chunks ?? [], existing?.notes ?? '', {
        reviewStatus: value.reviewStatus,
        selections: value.selections,
      });
    },
    { enabled: hydrated },
  );

  if (!data?.sentence || !data.book) {
    return <p className="muted">Loading sentence…</p>;
  }

  const { sentence, memberships, index, book } = data;
  const matchingSourceId = book.sourceKey?.startsWith('shadowing:')
    ? book.sourceKey.slice('shadowing:'.length)
    : undefined;
  const orderedAudio = [...(data.sentenceAudio ?? [])].sort((a, b) => {
    if (a.sourceId === matchingSourceId) return -1;
    if (b.sourceId === matchingSourceId) return 1;
    return a.startMs - b.startMs;
  });
  const prev = index > 0 ? memberships[index - 1] : null;
  const next =
    index >= 0 && index < memberships.length - 1 ? memberships[index + 1] : null;

  // Show "Confirm and next →" even when this is the last sentence of the book,
  // as long as today's session still has this sentence's vocabulary step
  // pending and something queued after it — confirming will carry the learner
  // on to that next session step (see the onConfirm handlers below).
  const sessionHasStepForThisSentence = Boolean(
    activeSession?.session.steps.some(
      (step) =>
        (step.status === 'pending' || step.status === 'active') &&
        step.targetKind === 'vocabulary_review' &&
        step.sentenceId === sentenceId,
    ),
  );
  const sessionHasLaterStep =
    (activeSession?.session.steps.filter(
      (step) => step.status === 'pending' || step.status === 'active',
    ).length ?? 0) > 1;
  const sessionAdvanceReady = sessionHasStepForThisSentence && sessionHasLaterStep;

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="muted">{book.title}</div>
            <strong>
              {index + 1} of {memberships.length}
            </strong>
          </div>
          <div className="row">
            <button
              type="button"
              disabled={!prev}
              onClick={() =>
                prev &&
                navigate(`/books/${bookId}/vocabulary/${prev.sentenceId}`)
              }
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!next}
              onClick={() =>
                next &&
                navigate(`/books/${bookId}/vocabulary/${next.sentenceId}`)
              }
            >
              Next
            </button>
            <Link to={`/books/${bookId}/analyze/${sentenceId}`}>
              <button type="button" className="ghost">
                Analyze
              </button>
            </Link>
            <Link to={`/books/${bookId}`}>
              <button type="button" className="ghost">
                Book
              </button>
            </Link>
          </div>
        </div>
        <div className="jp jp-lg">{sentence.japanese}</div>
        <div className="row">
          {orderedAudio.map((audio, audioIndex) => (
            <NativeAudioButton
              key={audio.id}
              audio={audio}
              displayLabel={
                orderedAudio.length > 1
                  ? `Native ${audioIndex + 1}`
                  : undefined
              }
            />
          ))}
          <SpeakButton
            text={sentence.japanese}
            itemId={`sentence-${sentence.id}`}
            label="Play Japanese sentence with device TTS"
            displayLabel="TTS"
          />
          <span className={`status-pill ${saveState}`}>
            {saveState === 'saving'
              ? 'Saving…'
              : saveState === 'saved'
                ? 'Saved'
                : saveState === 'failed'
                  ? 'Save failed'
                  : saveState === 'dirty'
                    ? 'Unsaved'
                    : 'Ready'}
          </span>
        </div>
        <VocabChips items={sentence.targetVocabulary} />
      </section>

      <VocabularyPicker
        japanese={sentence.japanese}
        suggestions={sentence.vocabularySuggestions ?? []}
        selections={selections}
        reviewStatus={reviewStatus}
        hasNext={Boolean(next) || sessionAdvanceReady}
        onChange={({ selections: nextSelections, reviewStatus: nextStatus }) => {
          setSelections(nextSelections);
          setReviewStatus(nextStatus);
        }}
        onConfirm={(payload) => {
          setSelections(payload.selections);
          setReviewStatus(payload.reviewStatus);
          // Advances to the next session step when a session is running;
          // otherwise stays put (no book-next fallback — that's what
          // "Confirm and next →" is for).
          void confirmSentenceVocabulary(sentenceId, payload.selections).then(
            ({ nextSessionStep }) => advanceToSessionStep(nextSessionStep),
          );
        }}
        onConfirmAndNext={(payload) => {
          setSelections(payload.selections);
          setReviewStatus(payload.reviewStatus);
          void confirmSentenceVocabulary(sentenceId, payload.selections).then(
            ({ nextSessionStep }) => {
              // Session step first; fall back to the next sentence in this book.
              if (!advanceToSessionStep(nextSessionStep) && next) {
                navigate(`/books/${bookId}/vocabulary/${next.sentenceId}`);
              }
            },
          );
        }}
      />
    </div>
  );
}
