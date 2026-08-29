import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { NativeAudioButton } from '../components/NativeAudioButton';
import { SpeakButton } from '../components/SpeakButton';
import { VocabChips } from '../components/VocabChips';
import { VocabularyPicker } from '../components/VocabularyPicker';
import {
  confirmSentenceVocabulary,
  getDb,
  saveAnalysis,
  updateSentenceVocabularySuggestions,
} from '../db/repository';
import type {
  VocabularyReviewStatus,
  VocabularySelection,
  VocabularySuggestion,
} from '../domain/types';
import { glossVocabulary } from '../lib/vocabAssist';
import {
  defaultSelectionsFromSuggestions,
  isContentPos,
} from '../lib/vocabularySuggestions';
import { useAutosave } from '../hooks/useAutosave';

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

  // Just-in-time AI glossing: when this sentence's content words have no
  // English meaning yet (every word mined from YouTube starts blank — fugashi
  // gives no gloss), fill them in context via `vocab-assist`, once per
  // sentence. Degrades silently — offline / signed-out just leaves the fields
  // blank, exactly as before.
  const [glossState, setGlossState] = useState<'idle' | 'loading' | 'error'>('idle');
  const glossAttempted = useRef<Set<string>>(new Set());
  const japanese = data?.sentence?.japanese ?? '';

  useEffect(() => {
    if (!hydrated || !data?.sentence) return;
    const { id: activeId, vocabularySuggestions } = data.sentence;
    if (glossAttempted.current.has(activeId)) return;
    const suggestions = vocabularySuggestions ?? [];
    const needing = suggestions.filter(
      (item) => isContentPos(item.pos) && !item.english?.trim(),
    );
    if (needing.length === 0) return;
    glossAttempted.current.add(activeId);

    let cancelled = false;
    setGlossState('loading');
    void (async () => {
      const result = await glossVocabulary({
        sentence: japanese,
        words: needing.map((item) => ({
          expression: item.expression,
          reading: item.reading,
          surface: item.surface,
        })),
      });
      if (cancelled) return;
      if (!result.ok) {
        setGlossState('error');
        return;
      }
      setGlossState('idle');
      const byExpression = new Map(
        result.data.glosses
          .filter((gloss) => gloss.meaning?.trim())
          .map((gloss) => [gloss.expression, gloss]),
      );
      if (byExpression.size === 0) return;

      const nextSuggestions: VocabularySuggestion[] = suggestions.map((item) =>
        !item.english?.trim() && byExpression.has(item.expression)
          ? { ...item, english: byExpression.get(item.expression)!.meaning }
          : item,
      );
      await updateSentenceVocabularySuggestions(activeId, nextSuggestions);
      setSelections((current) =>
        current.map((selection) => {
          if (selection.english?.trim()) return selection;
          const gloss = byExpression.get(selection.expression);
          if (!gloss) return selection;
          return {
            ...selection,
            english: gloss.meaning,
            pos: selection.pos || gloss.partOfSpeech,
          };
        }),
      );
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, data?.sentence?.id]);

  const handleSuggestMeaning = useCallback(
    async (word: { expression: string; reading: string }) => {
      if (!japanese) return null;
      const result = await glossVocabulary({
        sentence: japanese,
        words: [{ expression: word.expression, reading: word.reading }],
      });
      if (!result.ok) return null;
      const gloss = result.data.glosses.find((item) => item.meaning?.trim());
      return gloss
        ? { meaning: gloss.meaning, partOfSpeech: gloss.partOfSpeech }
        : null;
    },
    [japanese],
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
          {glossState === 'loading' ? (
            <span className="muted">Glossing vocabulary…</span>
          ) : null}
        </div>
        <VocabChips items={sentence.targetVocabulary} />
      </section>

      <VocabularyPicker
        japanese={sentence.japanese}
        suggestions={sentence.vocabularySuggestions ?? []}
        selections={selections}
        reviewStatus={reviewStatus}
        saveState={saveState}
        onSuggestMeaning={handleSuggestMeaning}
        onChange={({ selections: nextSelections, reviewStatus: nextStatus }) => {
          setSelections(nextSelections);
          setReviewStatus(nextStatus);
        }}
        onConfirm={(payload) => {
          setSelections(payload.selections);
          setReviewStatus(payload.reviewStatus);
          // Just records the confirmation. Advancing through a session is the
          // SessionBar "Mark complete" button's job (single advance control).
          void confirmSentenceVocabulary(sentenceId, payload.selections);
        }}
      />
    </div>
  );
}
