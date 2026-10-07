import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { ChunkPuzzleStrip } from '../components/ChunkPuzzleStrip';
import { EpisodePreparationPanel } from '../components/EpisodePreparationPanel';
import { KaraokeSentenceText } from '../components/KaraokeSentenceText';
import { SentenceWalkthrough, walkthroughChunks } from '../components/SentenceWalkthrough';
import { glossesFromWords } from '../lib/chunkGlosses';
import { mergeChapterWalkthroughs } from '../lib/contextWalkthrough';
import { WordGlossList, type CompareAids } from '../components/TargetLessonCard';
import { ensureDefaultBookChapter, getDb, getEpisodeFocus, getSavedWordStatus, listGlossDecisions, listSentenceLearningEvents, logGlossDecision, logSentenceLearningEvent, readSettings, updateSettings } from '../db/repository';
import { registerReportContext } from '../lib/reportContext';
import type { BookSentence, Sentence, SentenceAudio, StructureDraftChunk, TextDisplayMode } from '../domain/types';
import { useNativeAudio } from '../hooks/useNativeAudio';
import { FuriganaText } from '../lib/furigana';
import { newWordSegments } from '../lib/newWordFurigana';
import type { EpisodeFocusTarget } from '../lib/episodeFocus';
import { isPreparationStale } from '../lib/episodePreparation';
import { SentenceJourneyDetails } from '../components/SentenceJourneyDetails';
import { buildSentenceJourney, sentencesReadyToRevisit } from '../lib/sentenceJourney';
import { describeSentenceProgress, glossableWords, sentenceWordHelp, summariseSentenceProgress } from '../lib/sentenceLearning';
import { PLAYBACK_SPEEDS } from '../lib/recording';
import { SentenceAudioAdjuster } from '../components/SentenceAudioAdjuster';

/**
 * Always-available, non-graded chapter/book read-along (2026-09-23 roadmap
 * idea, un-gated per user request 2026-09-26 — no vocabulary-coverage
 * unlock, just an occasional comprehension self-check). Not a card: no
 * `Review` row, no FSRS, no self-rating, same treatment as `ShadowPage`/`/play`.
 */
const READER_LAYOUT_KEY = 'satori-glossbook:reader-layout';
const READER_TEXT_MODE_KEY = 'satori-glossbook:reader-text-mode';
type ReaderTextMode = TextDisplayMode | 'new';
const TEXT_MODE_ORDER: ReaderTextMode[] = ['new', 'plain', 'furigana', 'reading'];
const TEXT_MODE_LABELS: Record<ReaderTextMode, string> = {
  new: 'Furigana on new words',
  plain: 'Plain Japanese',
  furigana: 'Furigana',
  reading: 'Reading-only',
};
const TEXT_MODE_GLYPHS: Record<ReaderTextMode, string> = { new: 'ふ新', plain: '文', furigana: 'ふ', reading: 'あ' };

function storedTextMode(): ReaderTextMode | undefined {
  try {
    const value = localStorage.getItem(READER_TEXT_MODE_KEY);
    return TEXT_MODE_ORDER.find((mode) => mode === value);
  } catch {
    return undefined;
  }
}

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
  const [displayMode, setDisplayModeState] = useState<ReaderTextMode>(() => storedTextMode() ?? 'new');
  function setDisplayMode(mode: ReaderTextMode) {
    setDisplayModeState(mode);
    try { localStorage.setItem(READER_TEXT_MODE_KEY, mode); } catch { /* storage unavailable */ }
  }
  const [playbackRate, setPlaybackRate] = useState(1);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loopSentence, setLoopSentence] = useState(false);
  const singleIndexRef = useRef<number | null>(null);
  const spanRef = useRef<{ start: number; end: number } | null>(null);
  const [contextBefore, setContextBefore] = useState(0);
  const [contextAfter, setContextAfter] = useState(0);
  const [barMenuOpen, setBarMenuOpen] = useState(false);
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
  const [chapterMode, setChapterMode] = useState(() => {
    try { return localStorage.getItem(READER_LAYOUT_KEY) !== 'original'; } catch { return true; }
  });
  const [selectedId, setSelectedId] = useState<string>();
  function changeLayout(chapter: boolean) {
    setChapterMode(chapter);
    try { localStorage.setItem(READER_LAYOUT_KEY, chapter ? 'chapter' : 'original'); } catch { /* storage unavailable */ }
  }

  useEffect(() => {
    if (settings && !storedTextMode()) {
      setDisplayModeState(settings.textDisplayMode === 'plain' ? 'new' : settings.textDisplayMode);
    }
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
    const particleChecksBySentence = new Map(
      analyses.flatMap((analysis) => (analysis?.particleChecks ? [[analysis.sentenceId, analysis.particleChecks] as const] : [])),
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
    // Drafts are keyed by sentence id, so reading the whole book (no ?chapter=) still finds them.
    const structureDrafts = Object.assign({}, ...book.chapters.map((item) => item.structureDrafts ?? {})) as Record<string, StructureDraftChunk[]>;
    const contextWalkthroughs = mergeChapterWalkthroughs(book.chapters);
    return { book, chapter, rows, audioRows, chunksBySentence, particleChecksBySentence, structureDrafts, contextWalkthroughs, savedMeanings, knownExpressions };
  }, [bookId, chapterId]);

  const openedLessonRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!lessonSentenceId || !data || openedLessonRef.current === lessonSentenceId) return;
    if (lessonChapterId === undefined) return;
    const index = data.rows.findIndex((row) => row.sentence.id === lessonSentenceId);
    if (index < 0) return;
    openedLessonRef.current = lessonSentenceId;
    setWalkthroughId(lessonSentenceId);
    setSelectedId(lessonSentenceId);
    setTimeout(() => rowRefs.current[index]?.scrollIntoView({ block: 'center' }), 0);
  }, [lessonSentenceId, lessonChapterId, data]);

  const focus = useLiveQuery(
    () => getEpisodeFocus(bookId, chapterId).catch(() => null),
    [bookId, chapterId],
  );

  const lessonEvents = useLiveQuery(() => listSentenceLearningEvents(bookId), [bookId]);
  const glossRecords = useLiveQuery(() => listGlossDecisions(), []);
  const episodeSentences = useMemo(
    () => (data ? data.rows.map((row, index) => ({ id: row.sentence.id, japanese: row.sentence.japanese, translation: row.sentence.translation, position: index + 1 })) : []),
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
    const playing = data?.rows[activeIndex]?.sentence.id;
    if (playing && !spanRef.current) setSelectedId(playing);
  }, [activeIndex, data]);

  useEffect(() => {
    if (activeIndex < 0 || singleIndexRef.current !== null) return;
    rowRefs.current[activeIndex]?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [activeIndex]);

  useEffect(() =>
    registerReportContext('reader', () => ({
      bookId,
      chapterIdFromUrl: chapterId ?? null,
      chapterLoaded: data?.chapter?.id ?? null,
      chapterDraftCounts: data?.book.chapters.map((item) => ({ id: item.id, structureDrafts: Object.keys(item.structureDrafts ?? {}).length })) ?? null,
      sentenceCount: data?.rows.length ?? null,
      selectedId,
      walkthroughId: walkthroughId ?? null,
      walkthroughSentenceLocal: walkthroughId && data
        ? {
            savedAnalysisChunks: data.chunksBySentence.get(walkthroughId)?.length ?? 0,
            structureDraftChunks: data.structureDrafts[walkthroughId]?.length ?? 0,
          }
        : null,
    })));

  if (data === undefined) return <p>Loading…</p>;
  if (data === null) return <p>Book not found.</p>;

  const { book, chapter, rows } = data;
  const focusedId = rows.some((row) => row.sentence.id === selectedId) ? selectedId : rows[0]?.sentence.id;
  const focusedIndex = rows.findIndex((row) => row.sentence.id === focusedId);
  const focusedRow = rows[focusedIndex];
  function selectLine(id: string) {
    setSelectedId(id);
    if (walkthroughId && walkthroughId !== id) setWalkthroughId(undefined);
  }
  function translationDefaultShown(sentence: Sentence) {
    const help = sentenceWordHelp(sentence.vocabularySuggestions, data!.knownExpressions, data!.savedMeanings);
    return help.total > 0 && help.unknownCount * 2 > help.total;
  }

  function findNextPlayable(fromIndex: number): number {
    for (let i = fromIndex; i < audioByRow.length; i += 1) {
      if (audioByRow[i]) return i;
    }
    return -1;
  }

  /** `single` plays just this sentence (stopping, or looping, at its end); `span` plays a sentence range while the focused sentence (and its controls) stays put. */
  function playFrom(index: number, single = false, loop = loopSentence, span?: { start: number; end: number; focus: number }) {
    const audio = audioByRow[index];
    if (!audio) return;
    setActiveIndex(index);
    singleIndexRef.current = single ? index : span ? span.focus : null;
    spanRef.current = span ? { start: span.start, end: span.end } : null;
    void native.play(audio, playbackRate, {
      loop: single && loop,
      onEnded: () => {
        if (single) {
          setActiveIndex(-1);
          return;
        }
        const next = findNextPlayable(index + 1);
        if (span) {
          if (next !== -1 && next <= span.end) {
            playFrom(next, false, loop, span);
            return;
          }
          const first = loop ? findNextPlayable(span.start) : -1;
          if (first !== -1 && first <= span.end) {
            playFrom(first, false, loop, span);
            return;
          }
          spanRef.current = null;
          setActiveIndex(-1);
          return;
        }
        if (next === -1) {
          setActiveIndex(-1);
          return;
        }
        playFrom(next);
      },
    });
  }

  /** Plays one sentence plus the chosen number of neighbours before/after it. */
  function playSentence(index: number, loop = loopSentence) {
    const start = Math.max(0, index - contextBefore);
    const end = Math.min(audioByRow.length - 1, index + contextAfter);
    if (start === end) {
      playFrom(index, true, loop);
      return;
    }
    const first = findNextPlayable(start);
    if (first === -1 || first > end) return;
    playFrom(first, false, loop, { start, end, focus: index });
  }

  const currentAudio = activeIndex >= 0 ? audioByRow[activeIndex] : undefined;
  const isSequencePlaying =
    native.isPlaying && !!currentAudio && native.activeItemId === currentAudio.id;
  const firstPlayable = findNextPlayable(0);

  function toggleSentencePlay(index: number) {
    if (isSequencePlaying && singleIndexRef.current === index) native.stop();
    else playSentence(index);
  }

  function toggleLoop() {
    const next = !loopSentence;
    setLoopSentence(next);
    if (isSequencePlaying && singleIndexRef.current !== null) playSentence(singleIndexRef.current, next);
  }

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
    const newWordRuby =
      displayMode === 'new'
        ? newWordSegments(sentence.japanese, sentence.inlineReading, sentence.vocabularySuggestions, data?.knownExpressions ?? new Set())
        : null;
    if ((displayMode === 'plain' || displayMode === 'new') && isActive && audio) {
      return (
        <KaraokeSentenceText
          audio={audio}
          japanese={sentence.japanese}
          vocabularySuggestions={sentence.vocabularySuggestions}
          targetVocabulary={sentence.targetVocabulary}
          rubySegments={newWordRuby ?? undefined}
        />
      );
    }
    if (newWordRuby) {
      return (
        <div className="jp jp-lg" lang="ja">
          {newWordRuby.map((segment, index) =>
            segment.kind === 'ruby' && segment.reading ? (
              <ruby key={index}>
                {segment.base}
                <rp>(</rp>
                <rt>{segment.reading}</rt>
                <rp>)</rp>
              </ruby>
            ) : (
              <span key={index}>{segment.base}</span>
            ),
          )}
        </div>
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

  function playbackBar(index: number, audio: SentenceAudio) {
    const playing = isSequencePlaying && singleIndexRef.current === index;
    const sourceUrl = audio.sourceUrl ?? book.sourceUrl;
    const counts = [0, 1, 2, 3];
    return (
      <div className="stack" style={{ gap: '0.3rem' }}>
        <div className="row" style={{ gap: '0.3rem', alignItems: 'center' }} role="toolbar" aria-label="Playback">
          <button type="button" className="icon-button" aria-label={playing ? 'Stop' : 'Play sentence'}
            title={playing ? 'Stop' : 'Play this sentence'} onClick={() => toggleSentencePlay(index)}>{playing ? '⏸' : '▶'}</button>
          <button type="button" className="icon-button" aria-pressed={loopSentence}
            aria-label={loopSentence ? 'Loop on' : 'Loop off'} title={loopSentence ? 'Loop: on' : 'Loop: off'}
            onClick={toggleLoop}>🔁</button>
          <button type="button" className="icon-button" aria-pressed={barMenuOpen} aria-expanded={barMenuOpen}
            aria-label="More playback options" title="Context, adjust clip"
            onClick={() => setBarMenuOpen((open) => !open)}>⋯</button>
          {contextBefore > 0 || contextAfter > 0 ? (
            <span className="muted" style={{ fontSize: '0.8em' }}>−{contextBefore} / +{contextAfter}</span>
          ) : null}
        </div>
        {barMenuOpen ? (
          <div className="stack" style={{ gap: '0.4rem' }}>
            <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="row" style={{ gap: '0.3rem' }}>
                <span className="muted">Before</span>
                <select aria-label="Sentences to play before" value={contextBefore} onChange={(event) => setContextBefore(Number(event.target.value))}>
                  {counts.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="row" style={{ gap: '0.3rem' }}>
                <span className="muted">After</span>
                <select aria-label="Sentences to play after" value={contextAfter} onChange={(event) => setContextAfter(Number(event.target.value))}>
                  {counts.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            {sourceUrl ? <SentenceAudioAdjuster audio={audio} sourceUrl={sourceUrl} /> : <span className="muted">No source video to re-cut from.</span>}
          </div>
        ) : null}
      </div>
    );
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
            onChange={(event) => setDisplayMode(event.target.value as ReaderTextMode)}
          >
            <option value="new">Furigana on new words</option>
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
      <div className="row" style={{ alignItems: 'center' }}>
        <label>
          Layout
          <select value={chapterMode ? 'chapter' : 'original'} onChange={(event) => changeLayout(event.target.value === 'chapter')}>
            <option value="chapter">Chapter + icons</option>
            <option value="original">Original · rows</option>
          </select>
        </label>
      </div>
      <div className={chapterMode ? 'gloss-workbench' : undefined}>
      <div className="stack reader-book">
        {rows.map((row, index) => {
          const audio = audioByRow[index];
          const isActive = index === activeIndex;
          if (chapterMode && row.sentence.id !== focusedId) {
            return (
              <div
                key={row.membership.id}
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                className={`reader-line${isActive ? ' reader-row-active' : ''}`}
                role="button"
                tabIndex={0}
                title="Select this sentence"
                onClick={() => selectLine(row.sentence.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectLine(row.sentence.id);
                  }
                }}
              >
                {sentenceLine(row.sentence, isActive, audio)}
              </div>
            );
          }
          return (
            <div
              key={row.membership.id}
              ref={(el) => {
                rowRefs.current[index] = el;
              }}
              className={`panel${isActive ? ' reader-row-active' : ''}`}
            >
              <div className="row" style={{ alignItems: 'flex-start' }}>
                {audio && !chapterMode ? (
                  <button
                    type="button"
                    className="speak-button compact"
                    aria-label={isActive && isSequencePlaying ? 'Stop' : chapterMode ? 'Play sentence' : 'Play from here'}
                    onClick={() =>
                      isActive && isSequencePlaying ? native.stop() : playFrom(index, chapterMode)
                    }
                  >
                    {isActive && isSequencePlaying ? '⏸' : '▶'}
                  </button>
                ) : null}
                <div className="stack" style={{ flex: 1, gap: '0.35rem' }}>
                  {chapterMode && audio ? playbackBar(index, audio) : null}
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
                          {chapterMode ? null : <button type="button" onClick={() => toggleTranslation(row.sentence.id)}>Hide translation</button>}
                        </>
                      ) : chapterMode ? null : (
                        <button type="button" onClick={() => toggleTranslation(row.sentence.id)}>Show translation</button>
                      );
                    })()}
                    {chapterMode ? null : (<>
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
                    </>)}
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
                      structureDraft={data.structureDrafts[row.sentence.id]}
                      audio={audio}
                      focusTargets={walkthroughFocus}
                      episodeSentences={episodeSentences}
                      compareAids={compareAids}
                      constructionDrafts={data.chapter?.constructionDrafts}
                      contextWalkthrough={data.contextWalkthroughs[row.sentence.id]}
                      importTarget={row.membership.chapterId ? { bookId, chapterId: row.membership.chapterId } : undefined}
                      events={lessonEvents ?? []}
                      glossRecords={glossRecords}
                      particleChecks={data.particleChecksBySentence.get(row.sentence.id)}
                      knownRatio={(() => {
                        const content = row.sentence.vocabularySuggestions.filter((suggestion) => suggestion.selectedByDefault);
                        return content.length === 0 ? undefined : content.filter((suggestion) => data.knownExpressions.has(suggestion.expression)).length / content.length;
                      })()}
                      skipCheck={searchParams.get('skipCheck') === '1'}
                      onGlossDecision={(decision) => void logGlossDecision({ ...decision, bookId })}
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
                        const { chunks: shown, source } = walkthroughChunks(
                          row.sentence,
                          data.chunksBySentence.get(row.sentence.id),
                          data.structureDrafts[row.sentence.id],
                        );
                        const wordGlosses = glossesFromWords(shown, compareAids?.get(row.sentence.id)?.words ?? []);
                        return (
                          <div className="stack" style={{ gap: '0.25rem' }}>
                            <ChunkPuzzleStrip
                              chunks={shown.map((chunk) => ({
                                id: chunk.id,
                                japanese: chunk.japanese,
                                role: chunk.role,
                                gloss: chunk.literalEnglish || wordGlosses.get(chunk.id),
                              }))}
                              showGloss
                            />
                            <span className="muted" style={{ fontSize: '0.8em' }}>
                              {source === 'saved'
                                ? 'From your saved analysis.'
                                : source === 'ai_draft'
                                  ? 'From the AI chunking you imported.'
                                  : 'Rough automatic guess, not a saved analysis — a quick peek at structure, not a substitute for working through it on Analyze.'}
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
      {chapterMode && focusedRow ? (() => {
        const translationOpen = translationDefaultShown(focusedRow.sentence) !== revealedTranslations.has(focusedRow.sentence.id);
        const wordOverride = wordHelpOverride.get(focusedRow.sentence.id);
        const walking = walkthroughId === focusedRow.sentence.id;
        const nextMode = TEXT_MODE_ORDER[(TEXT_MODE_ORDER.indexOf(displayMode) + 1) % TEXT_MODE_ORDER.length]!;
        return (
          <div className="gloss-rail" role="toolbar" aria-label="Sentence tools" aria-orientation="vertical">
            <button type="button" className="icon-button" aria-label="Previous sentence" title="Previous sentence" disabled={focusedIndex <= 0}
              onClick={() => selectLine(rows[focusedIndex - 1]!.sentence.id)}>↑</button>
            <button type="button" className="icon-button" aria-label="Next sentence" title="Next sentence" disabled={focusedIndex >= rows.length - 1}
              onClick={() => selectLine(rows[focusedIndex + 1]!.sentence.id)}>↓</button>
            <button type="button" className="icon-button" aria-pressed={isSequencePlaying && singleIndexRef.current === focusedIndex}
              aria-label={isSequencePlaying && singleIndexRef.current === focusedIndex ? 'Stop' : 'Play sentence'}
              title={isSequencePlaying && singleIndexRef.current === focusedIndex ? 'Stop' : 'Play this sentence'}
              disabled={!audioByRow[focusedIndex]}
              onClick={() => toggleSentencePlay(focusedIndex)}>{isSequencePlaying && singleIndexRef.current === focusedIndex ? '⏸' : '▶'}</button>
            <button type="button" className="icon-button" aria-pressed={loopSentence}
              aria-label={loopSentence ? 'Loop on' : 'Loop off'} title={loopSentence ? 'Loop this sentence: on' : 'Loop this sentence: off'}
              onClick={toggleLoop}>🔁</button>
            <button type="button" className="icon-button" aria-pressed={translationOpen}
              aria-label={translationOpen ? 'Hide translation' : 'Show translation'} title={translationOpen ? 'Hide translation' : 'Show translation'}
              onClick={() => toggleTranslation(focusedRow.sentence.id)}>EN</button>
            <button type="button" className="icon-button" aria-pressed={walking} aria-expanded={walking}
              aria-label="Walk through" title="Walk through this sentence"
              onClick={() => setWalkthroughId(walking ? undefined : focusedRow.sentence.id)}>🚶</button>
            <button type="button" className="icon-button" aria-pressed={revealedStructures.has(focusedRow.sentence.id)}
              aria-label={revealedStructures.has(focusedRow.sentence.id) ? 'Hide structure' : 'Show structure'}
              title={revealedStructures.has(focusedRow.sentence.id) ? 'Hide structure' : 'Show structure'}
              onClick={() => toggleStructure(focusedRow.sentence.id)}>🧱</button>
            <button type="button" className="icon-button" aria-pressed={wordOverride === 'all'}
              aria-label={wordOverride === 'all' ? 'Back to default word help' : 'Show all word help'}
              title={wordOverride === 'all' ? 'Back to default word help' : 'Show all word help'}
              onClick={() => setWordHelpOverride((prev) => {
                const next = new Map(prev);
                if (wordOverride === 'all') next.delete(focusedRow.sentence.id);
                else next.set(focusedRow.sentence.id, 'all');
                return next;
              })}>語</button>
            <button type="button" className="icon-button" aria-label={`Text: ${TEXT_MODE_LABELS[displayMode]}. Switch display`}
              title={`Text: ${TEXT_MODE_LABELS[displayMode]} (tap for ${TEXT_MODE_LABELS[nextMode]})`}
              onClick={() => setDisplayMode(nextMode)}>
              {TEXT_MODE_GLYPHS[displayMode]}
            </button>
            <Link className="icon-button" to={`/books/${bookId}`} aria-label="Back to book" title="Back to book">📖</Link>
          </div>
        );
      })() : null}
      </div>
    </div>
  );
}
