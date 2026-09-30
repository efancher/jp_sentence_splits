import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { ChunkPuzzleStrip } from '../components/ChunkPuzzleStrip';
import { EpisodePreparationPanel } from '../components/EpisodePreparationPanel';
import { KaraokeSentenceText } from '../components/KaraokeSentenceText';
import { SentenceWalkthrough } from '../components/SentenceWalkthrough';
import { WordGlossList, type CompareAids } from '../components/TargetLessonCard';
import { ensureDefaultBookChapter, getDb, getEpisodeFocus, getSavedWordStatus, listSentenceLearningEvents, logSentenceLearningEvent, readSettings, updateSettings } from '../db/repository';
import type { BookSentence, Sentence, SentenceAudio, TextDisplayMode } from '../domain/types';
import { useNativeAudio } from '../hooks/useNativeAudio';
import { FuriganaText } from '../lib/furigana';
import { previewHeuristicChunks } from '../lib/analysisHelpers';
import type { EpisodeFocusTarget } from '../lib/episodeFocus';
import { isPreparationStale } from '../lib/episodePreparation';
import { SentenceJourneyDetails } from '../components/SentenceJourneyDetails';
import { buildSentenceJourney, sentencesReadyToRevisit } from '../lib/sentenceJourney';
import { describeSentenceProgress, glossableWords, sentenceWordHelp, summariseSentenceProgress } from '../lib/sentenceLearning';
import { PLAYBACK_SPEEDS } from '../lib/recording';

/**
 * Always-available, non-graded chapter/book read-along (2026-09-23 roadmap
 * idea, un-gated per user request 2026-09-26 — no vocabulary-coverage
 * unlock, just an occasional comprehension self-check). Not a card: no
 * `Review` row, no FSRS, no self-rating, same treatment as `ShadowPage`/`/play`.
 */
export function ReaderPage() {
  const { bookId = '', sentenceId: lessonSentenceId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // /books/:bookId/learn/:sentenceId (planner lesson step) shows the sentence's own chapter.
  const lessonChapterId = useLiveQuery(
    async () =>
      lessonSentenceId
        ? (await getDb().bookSentences.where('[bookId+sentenceId]').equals([bookId, lessonSentenceId]).first())
            ?.chapterId ?? null
        : null,
    [bookId, lessonSentenceId],
  );
  const chapterId = searchParams.get('chapter') || lessonChapterId || undefined;
  const native = useNativeAudio();
  const settings = useLiveQuery(() => readSettings(), []);
  const [displayMode, setDisplayMode] = useState<TextDisplayMode>('plain');
  const [playbackRate, setPlaybackRate] = useState(1);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [revealedTranslations, setRevealedTranslations] = useState<Set<string>>(
    () => new Set(),
  );
  /** Sentences with the ungated heuristic structure preview open — a rough, client-side-only chunk guess (no AI, no saved analysis), available regardless of whether the sentence has cleared the `continue_book` gate yet. */
  const [revealedStructures, setRevealedStructures] = useState<Set<string>>(
    () => new Set(),
  );
  const [walkthroughId, setWalkthroughId] = useState<string>();
  /** Per-sentence override of the default word help: show every word, or none. */
  const [wordHelpOverride, setWordHelpOverride] = useState<Map<string, 'all' | 'none'>>(() => new Map());
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    if (settings) setDisplayMode(settings.textDisplayMode);
  }, [settings]);

  const data = useLiveQuery(async () => {
    const db = getDb();
    const book = await db.books.get(bookId);
    if (!book) return null;
    const allMemberships = await db.bookSentences
      .where('bookId')
      .equals(bookId)
      .sortBy('position');
    const memberships = chapterId
      ? allMemberships.filter((item) => item.chapterId === chapterId)
      : allMemberships;
    const sentences = await db.sentences.bulkGet(
      memberships.map((item) => item.sentenceId),
    );
    const rows: { membership: BookSentence; sentence: Sentence }[] = [];
    memberships.forEach((membership, index) => {
      const sentence = sentences[index];
      if (sentence) rows.push({ membership, sentence });
    });
    const audioRows = await db.sentenceAudio
      .where('sentenceId')
      .anyOf(rows.map((row) => row.sentence.id))
      .toArray();
    const chapter = chapterId
      ? book.chapters.find((item) => item.id === chapterId) ?? null
      : null;
    const analyses = await db.analyses.bulkGet(rows.map((row) => row.sentence.id));
    const chunksBySentence = new Map(
      analyses.flatMap((analysis) => (analysis ? [[analysis.sentenceId, analysis.chunks] as const] : [])),
    );
    const contentExpressions = [
      ...new Set(
        rows.flatMap((row) =>
          row.sentence.vocabularySuggestions
            .filter((suggestion) => suggestion.selectedByDefault)
            .map((suggestion) => suggestion.expression),
        ),
      ),
    ];
    const { savedMeanings, knownExpressions } = await getSavedWordStatus(contentExpressions);
    return { book, chapter, rows, audioRows, chunksBySentence, savedMeanings, knownExpressions };
  }, [bookId, chapterId]);

  const openedLessonRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!lessonSentenceId || !data || openedLessonRef.current === lessonSentenceId) return;
    if (lessonChapterId === undefined) return;
    const index = data.rows.findIndex((row) => row.sentence.id === lessonSentenceId);
    if (index < 0) return;
    openedLessonRef.current = lessonSentenceId;
    setWalkthroughId(lessonSentenceId);
    setTimeout(() => rowRefs.current[index]?.scrollIntoView({ block: 'center' }), 0);
  }, [lessonSentenceId, lessonChapterId, data]);

  const focus = useLiveQuery(
    () => getEpisodeFocus(bookId, chapterId).catch(() => null),
    [bookId, chapterId],
  );

  const lessonEvents = useLiveQuery(() => listSentenceLearningEvents(bookId), [bookId]);
  const episodeSentences = useMemo(
    () => (data ? data.rows.map((row, index) => ({ id: row.sentence.id, japanese: row.sentence.japanese, position: index + 1 })) : []),
    [data],
  );
  const preparation = data?.chapter?.preparation;
  const walkthroughFocus: EpisodeFocusTarget[] = useMemo(() => {
    if (!data || !preparation || preparation.targets.length === 0) return focus?.focus ?? [];
    if (isPreparationStale(preparation, data.rows.map((row) => ({ id: row.sentence.id, japanese: row.sentence.japanese })))) {
      return focus?.focus ?? [];
    }
    return preparation.targets
      .filter((target) => target.decision !== 'dismissed')
      .map((target) => ({
        kind: target.kind === 'grammar' ? ('grammar' as const) : ('vocabulary' as const),
        id: target.vocabularyItemId ?? target.grammarPatternId ?? `expression:${target.label}`,
        label: target.label,
        detail: target.learnerNote || target.reason,
        sentenceIds: [...new Set(target.occurrences.map((occurrence) => occurrence.sentenceId))],
        reasons: [target.reason],
        occurrences: target.occurrences.map(({ sentenceId, start, end }) => ({ sentenceId, start, end })),
        preparedKind: target.kind,
      }));
  }, [data, preparation, focus]);

  const matchingSourceId =
    data?.chapter?.sourceId ??
    (data?.book.sourceKey?.startsWith('shadowing:')
      ? data.book.sourceKey.slice('shadowing:'.length)
      : undefined);

  const audioByRow = useMemo(() => {
    if (!data) return [];
    return data.rows.map((row) => {
      const candidates = data.audioRows.filter(
        (audio) => audio.sentenceId === row.sentence.id,
      );
      return (
        candidates.find((audio) => audio.sourceId === matchingSourceId) ??
        candidates[0]
      );
    });
  }, [data, matchingSourceId]);

  const compareAids = useMemo(() => {
    const map = new Map<string, CompareAids>();
    data?.rows.forEach((row, index) => {
      map.set(row.sentence.id, {
        translation: row.sentence.translation || undefined,
        words: glossableWords(row.sentence.vocabularySuggestions, data.savedMeanings),
        audio: audioByRow[index],
      });
    });
    return map;
  }, [data, audioByRow]);

  useEffect(() => {
    if (activeIndex < 0) return;
    rowRefs.current[activeIndex]?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [activeIndex]);

  if (data === undefined) return <p>Loading…</p>;
  if (data === null) return <p>Book not found.</p>;

  const { book, chapter, rows } = data;

  function findNextPlayable(fromIndex: number): number {
    for (let i = fromIndex; i < audioByRow.length; i += 1) {
      if (audioByRow[i]) return i;
    }
    return -1;
  }

  function playFrom(index: number) {
    const audio = audioByRow[index];
    if (!audio) return;
    setActiveIndex(index);
    void native.play(audio, playbackRate, {
      onEnded: () => {
        const next = findNextPlayable(index + 1);
        if (next === -1) {
          setActiveIndex(-1);
          return;
        }
        playFrom(next);
      },
    });
  }

  const currentAudio = activeIndex >= 0 ? audioByRow[activeIndex] : undefined;
  const isSequencePlaying =
    native.isPlaying && !!currentAudio && native.activeItemId === currentAudio.id;
  const firstPlayable = findNextPlayable(0);

  function toggleSequence() {
    if (isSequencePlaying) {
      native.stop();
      return;
    }
    const start = activeIndex >= 0 ? activeIndex : firstPlayable;
    if (start === -1) return;
    playFrom(start);
  }

  function toggleTranslation(sentenceId: string) {
    setRevealedTranslations((prev) => {
      const next = new Set(prev);
      if (next.has(sentenceId)) next.delete(sentenceId);
      else next.add(sentenceId);
      return next;
    });
  }

  function toggleStructure(sentenceId: string) {
    setRevealedStructures((prev) => {
      const next = new Set(prev);
      if (next.has(sentenceId)) next.delete(sentenceId);
      else next.add(sentenceId);
      return next;
    });
  }

  function sentenceLine(sentence: Sentence, isActive: boolean, audio?: SentenceAudio) {
    if (displayMode === 'plain' && isActive && audio) {
      return (
        <KaraokeSentenceText
          audio={audio}
          japanese={sentence.japanese}
          vocabularySuggestions={sentence.vocabularySuggestions}
          targetVocabulary={sentence.targetVocabulary}
        />
      );
    }
    if (displayMode === 'furigana') {
      return (
        <div className="jp jp-lg">
          <FuriganaText text={sentence.inlineReading || sentence.japanese} />
        </div>
      );
    }
    if (displayMode === 'reading') {
      return <div className="jp jp-lg">{sentence.readingOnly || sentence.japanese}</div>;
    }
    return <div className="jp jp-lg">{sentence.japanese}</div>;
  }

  return (
    <div className="stack">
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0 }}>{chapter ? chapter.title : book.title}</h2>
          {chapter ? <p className="muted" style={{ margin: 0 }}>{book.title}</p> : null}
        </div>
        <Link to={`/books/${bookId}`}>Back to book</Link>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Just for comprehensible-input practice — not scored, not scheduled.
        Play through and see how much you can follow.
      </p>
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={firstPlayable === -1}
          onClick={toggleSequence}
        >
          {isSequencePlaying ? '⏸ Stop' : activeIndex >= 0 ? '▶ Resume' : '▶ Play'}
        </button>
        <label>
          Speed
          <select
            value={playbackRate}
            onChange={(event) => setPlaybackRate(Number(event.target.value))}
          >
            {PLAYBACK_SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value === 1 ? '1× (normal)' : `${value}×`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Text
          <select
            value={displayMode}
            onChange={(event) => setDisplayMode(event.target.value as TextDisplayMode)}
          >
            <option value="plain">Plain Japanese</option>
            <option value="furigana">Furigana</option>
            <option value="reading">Reading-only</option>
          </select>
        </label>
      </div>
      {focus && (focus.focus.length > 0 || focus.glossOnly.length > 0) ? (
        <details className="episode-focus">
          <summary>Suggested focus for this {chapter ? 'episode' : 'book'}</summary>
          <p className="muted">
            A draft from what recurs across the whole {chapter ? 'episode' : 'book'}. Optional: nothing here gates
            reading, and nothing is scheduled.
          </p>
          <ul>
            {focus.focus.map((target) => (
              <li key={`${target.kind}:${target.id}`}>
                <strong className="jp">{target.label}</strong>
                <span className="muted"> ({target.kind === 'grammar' ? 'grammar' : 'word'}) {target.detail}</span>
                <div className="muted">{target.reasons.join(' · ')}</div>
              </li>
            ))}
          </ul>
          {focus.glossOnly.length > 0 ? (
            <p className="muted">
              Gloss only (interchangeable discourse wording):{' '}
              <span className="jp">{focus.glossOnly.map((item) => item.label).join('、')}</span>
            </p>
          ) : null}
        </details>
      ) : null}
      {walkthroughFocus.length > 0 ? (
        <p style={{ margin: 0 }} aria-label="Episode focus">
          <span className="muted">Worth noticing across this {chapter ? 'episode' : 'book'}: </span>
          <span className="jp">{walkthroughFocus.map((target) => target.label).join('、')}</span>
        </p>
      ) : null}
      {(() => {
        const inThis = new Set(data.rows.map((row) => row.sentence.id));
        const ready = sentencesReadyToRevisit(lessonEvents ?? []).filter((id) => inThis.has(id));
        return ready.length > 0 ? (
          <div className="stack" style={{ gap: '0.25rem' }} aria-label="Ready for a fresh try">
            <span className="muted">
              Ready for a fresh try ({ready.length}): you walked through {ready.length === 1 ? 'this sentence' : 'these sentences'} on an earlier day.
              Try saying {ready.length === 1 ? 'it' : 'them'} from the meaning alone, with no cues. A suggestion, not a schedule.
            </span>
            <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
              {ready.slice(0, 5).map((id) => {
                const index = data.rows.findIndex((row) => row.sentence.id === id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setWalkthroughId(id);
                      rowRefs.current[index]?.scrollIntoView({ block: 'center' });
                    }}
                  >
                    Sentence {index + 1}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null;
      })()}
      {searchParams.get('imported') === '1' ? (
        <p className="muted" role="note" style={{ margin: 0 }}>
          Just imported. Optional: run <code>npm run validate:sentence-transcripts -- --book {bookId}</code> to check these
          transcripts against a fresh ASR pass.
        </p>
      ) : null}
      {(() => {
        const packChapterId = chapterId && chapter ? chapterId : !chapterId && book.chapters.length === 1 ? book.chapters[0]!.id : undefined;
        return packChapterId ? <EpisodePreparationPanel bookId={bookId} chapterId={packChapterId} defaultOpen={searchParams.get('pack') === '1'} /> : null;
      })()}
      {!chapterId && book.chapters.length === 0 && rows.length > 0 ? (
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() =>
              void ensureDefaultBookChapter(bookId).then((id) => {
                if (id) navigate(`/books/${bookId}/read?chapter=${encodeURIComponent(id)}&pack=1`);
              })
            }
          >
            Prepare this book (optional)
          </button>
          <span className="muted">Puts every sentence into one &ldquo;Whole book&rdquo; chapter so episode focus and translations can be prepared.</span>
        </div>
      ) : null}
      {firstPlayable === -1 ? (
        <p className="muted">No native audio for this {chapter ? 'chapter' : 'book'} yet.</p>
      ) : null}
      <div className="stack reader-book">
        {rows.map((row, index) => {
          const audio = audioByRow[index];
          const isActive = index === activeIndex;
          return (
            <div
              key={row.membership.id}
              ref={(el) => {
                rowRefs.current[index] = el;
              }}
              className={`panel${isActive ? ' reader-row-active' : ''}`}
            >
              <div className="row" style={{ alignItems: 'flex-start' }}>
                {audio ? (
                  <button
                    type="button"
                    className="speak-button compact"
                    aria-label={isActive && isSequencePlaying ? 'Stop' : 'Play from here'}
                    onClick={() =>
                      isActive && isSequencePlaying ? native.stop() : playFrom(index)
                    }
                  >
                    {isActive && isSequencePlaying ? '⏸' : '▶'}
                  </button>
                ) : null}
                <div className="stack" style={{ flex: 1, gap: '0.35rem' }}>
                  {sentenceLine(row.sentence, isActive, audio)}
                  {(() => {
                    const here = walkthroughFocus.filter((target) => target.sentenceIds.includes(row.sentence.id));
                    return here.length > 0 ? (
                      <span className="muted" style={{ fontSize: '0.85em' }}>
                        Focus here: <span className="jp">{here.map((target) => target.label).join('、')}</span>
                      </span>
                    ) : null;
                  })()}
                  {(() => {
                    const help = sentenceWordHelp(row.sentence.vocabularySuggestions, data.knownExpressions, data.savedMeanings);
                    const override = wordHelpOverride.get(row.sentence.id);
                    const shown = override === 'all' ? help.allWords : override === 'none' ? [] : help.newWords;
                    const setOverride = (value: 'all' | 'none' | undefined) =>
                      setWordHelpOverride((prev) => {
                        const next = new Map(prev);
                        if (value) next.set(row.sentence.id, value);
                        else next.delete(row.sentence.id);
                        return next;
                      });
                    if (help.allWords.length === 0) return null;
                    return (
                      <div className="stack" style={{ gap: '0.15rem' }}>
                        {shown.length > 0 ? <WordGlossList words={shown} /> : null}
                        <span className="muted" style={{ fontSize: '0.8em' }}>
                          {override === 'all'
                            ? 'Showing every word. '
                            : override === 'none'
                              ? 'Word help hidden. '
                              : help.newWords.length > 0
                                ? `${help.unknownCount} of ${help.total} words are new to you. `
                                : 'You know these words. '}
                          {override !== 'all' && help.allWords.length > shown.length ? (
                            <button type="button" onClick={() => setOverride('all')}>Show all words</button>
                          ) : null}{' '}
                          {shown.length > 0 && override !== 'none' ? (
                            <button type="button" onClick={() => setOverride('none')}>Hide</button>
                          ) : null}
                          {override ? (
                            <button type="button" onClick={() => setOverride(undefined)}>Reset</button>
                          ) : null}
                        </span>
                      </div>
                    );
                  })()}
                  <div className="row" style={{ gap: '0.5rem' }}>
                    {(() => {
                      const help = sentenceWordHelp(row.sentence.vocabularySuggestions, data.knownExpressions, data.savedMeanings);
                      // Mostly-unknown sentences show their translation by default; the toggle flips the default either way.
                      const mostlyUnknown = help.total > 0 && help.unknownCount * 2 > help.total;
                      const shown = mostlyUnknown !== revealedTranslations.has(row.sentence.id);
                      return shown ? (
                        <>
                          <div className="muted">{row.sentence.translation || '(no translation)'}</div>
                          <button type="button" onClick={() => toggleTranslation(row.sentence.id)}>Hide translation</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => toggleTranslation(row.sentence.id)}>Show translation</button>
                      );
                    })()}
                    <button
                      type="button"
                      aria-expanded={walkthroughId === row.sentence.id}
                      onClick={() => setWalkthroughId(walkthroughId === row.sentence.id ? undefined : row.sentence.id)}
                    >
                      Walk through
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleStructure(row.sentence.id)}
                    >
                      {revealedStructures.has(row.sentence.id) ? 'Hide structure' : 'Show structure'}
                    </button>
                  </div>
                  {(() => {
                    const progress = describeSentenceProgress(summariseSentenceProgress(lessonEvents ?? [], row.sentence.id));
                    if (!progress) return null;
                    const journey = buildSentenceJourney({
                      sentenceId: row.sentence.id,
                      events: lessonEvents ?? [],
                      vocabulary: row.sentence.vocabularySuggestions
                        .filter((item) => item.selectedByDefault)
                        .map((item) => ({ expression: item.expression, surface: item.surface })),
                      knownExpressions: data.knownExpressions,
                      structure: walkthroughFocus
                        .filter((target) => target.sentenceIds.includes(row.sentence.id) && (target.kind === 'grammar' || target.preparedKind === 'expression'))
                        .map((target) => ({ key: target.id, label: target.label })),
                    });
                    return (
                      <>
                        <div className="muted" aria-label="Sentence progress">Your progress here: {progress}</div>
                        <SentenceJourneyDetails journey={journey} />
                      </>
                    );
                  })()}
                  {walkthroughId === row.sentence.id ? (
                    <SentenceWalkthrough
                      sentence={row.sentence}
                      savedChunks={data.chunksBySentence.get(row.sentence.id)}
                      structureDraft={data.chapter?.structureDrafts?.[row.sentence.id]}
                      audio={audio}
                      focusTargets={walkthroughFocus}
                      episodeSentences={episodeSentences}
                      compareAids={compareAids}
                      events={lessonEvents ?? []}
                      onEvent={(event) =>
                        void logSentenceLearningEvent({
                          ...event,
                          bookId,
                          chapterId,
                          inventoryRevision: preparation?.sentenceFingerprint,
                        })
                      }
                      shadowHref={`#/books/${bookId}/shadow/${row.sentence.id}`}
                      quietMode={settings?.quietMode ?? false}
                      onQuietModeChange={(quiet) => void updateSettings({ quietMode: quiet })}
                      onClose={() => setWalkthroughId(undefined)}
                    />
                  ) : null}
                  {revealedStructures.has(row.sentence.id)
                    ? (() => {
                        const preview = previewHeuristicChunks(row.sentence.japanese);
                        return (
                          <div className="stack" style={{ gap: '0.25rem' }}>
                            <ChunkPuzzleStrip
                              chunks={preview.parts.map((japanese, partIndex) => ({
                                id: `${row.sentence.id}-${partIndex}`,
                                japanese,
                                role: preview.roles[partIndex] ?? '',
                              }))}
                            />
                            <span className="muted" style={{ fontSize: '0.8em' }}>
                              Rough automatic guess, not a saved analysis — a quick peek at
                              structure, not a substitute for working through it on Analyze.
                            </span>
                          </div>
                        );
                      })()
                    : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
