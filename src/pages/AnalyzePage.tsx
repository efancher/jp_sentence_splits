import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ROLE_PRESET_GROUPS, ROLE_PRESETS } from '../appConfig';
import { ChapterReader } from '../components/ChapterReader';
import { ChunkPuzzleStrip } from '../components/ChunkPuzzleStrip';
import { ComprehensionCheckPicker } from '../components/ComprehensionCheckPicker';
import { GrammarPicker } from '../components/GrammarPicker';
import { buildSentenceTokens } from '../components/KaraokeSentenceText';
import { NativeAudioButton } from '../components/NativeAudioButton';
import { SegmentLoopPlayer } from '../components/SegmentLoopPlayer';
import { SentenceAudioAdjuster } from '../components/SentenceAudioAdjuster';
import { SpeakButton } from '../components/SpeakButton';
import { VocabChips } from '../components/VocabChips';
import { readSettings } from '../db/database';
import {
  deleteSentenceCascade,
  getDb,
  getRoleOccurrenceStats,
  saveAnalysis,
  setBookSentenceStatus,
  updateSentenceText,
} from '../db/repository';
import type { RoleOccurrenceStats } from '../db/repository';
import type {
  AnalysisChunk,
  Sentence,
  SentenceAudio,
  SentenceVocabulary,
  TextDisplayMode,
} from '../domain/types';
import {
  addZeroGaSubject,
  applyHeuristicChunks,
  applySpacedChunks,
  chunkHasSpeakableJapanese,
  countDiscardedAnnotations,
  hasZeroGaSubject,
  initialSpacedText,
  isZeroGaChunk,
  mergeChunkWithNeighbor,
  moveChunk,
  moveChunkBoundary,
  previewHeuristicChunks,
  removeZeroGaSubject,
  splitChunkAt,
  surfaceJapaneseParts,
} from '../lib/analysisHelpers';
import { isEngineRole } from '../lib/clauseBands';
import {
  applySuggestion,
  lintAnalysis,
} from '../lib/analysisSuggestions';
import { AMBIGUITY_PRONE_ROLES, RoleGuideContent, roleGuideBlurb } from '../lib/roleGuide';
import { surfaceReadingFromInline } from '../lib/readingAnswer';
import { explainChunkWhy } from '../lib/chunkWhyAssist';
import { suggestStickyEnglish } from '../lib/stickyEnglish';
import { FuriganaText } from '../lib/furigana';
import { ichiMoeUrl } from '../lib/ichiMoe';
import {
  copyText,
  downloadText,
  formatWorksheetBlock,
  shareText,
  summarizeChunks,
} from '../lib/worksheet';
import { useAutosave } from '../hooks/useAutosave';
import { useJapaneseSpeech } from '../hooks/useJapaneseSpeech';
import { useNativeAudio } from '../hooks/useNativeAudio';

const CUSTOM_ROLE_VALUE = '__custom__';
const ROLE_PRESET_SET = new Set<string>(ROLE_PRESETS);

const SENTENCE_STATUS_LABEL: Record<string, string> = {
  unstarted: 'Not started',
  in_progress: 'In progress',
  complete: 'Complete',
  needs_review: 'Needs review',
};

/**
 * "You've seen this role before" fading callback (Cure Dolly's "we saw this
 * in lesson 3" texture) — shown for the first ROLE_RECURRENCE_FADE_THRESHOLD
 * times a role recurs across the whole corpus, then silently omitted so the
 * page doesn't get noisier as the learner advances. Purely informational,
 * same trust tier as the static role-guide panel — not SRS, no tracking of
 * whether it was read.
 */
const ROLE_RECURRENCE_FADE_THRESHOLD = 5;

function roleGuideCallout(
  role: string,
  stats: Map<string, RoleOccurrenceStats> | undefined,
) {
  const trimmed = role.trim();
  if (!trimmed || !stats) return null;
  const entry = stats.get(trimmed);
  if (!entry || entry.count > ROLE_RECURRENCE_FADE_THRESHOLD) return null;
  return (
    <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
      You&rsquo;ve seen 「{trimmed}」{' '}
      {entry.count === 1 ? 'once before' : `${entry.count} times before`}.
    </p>
  );
}

const GLOSS_LAYOUT_KEY = 'satori-glossbook:gloss-layout';
const TEXT_MODE_ORDER: TextDisplayMode[] = ['plain', 'furigana', 'reading'];
const TEXT_MODE_LABELS: Record<TextDisplayMode, string> = { plain: 'Plain Japanese', furigana: 'Furigana', reading: 'Reading-only' };

export function AnalyzePage() {
  const { bookId = '', sentenceId = '' } = useParams();
  const navigate = useNavigate();
  const settings = useLiveQuery(() => readSettings(), []);
  const [displayMode, setDisplayMode] = useState<TextDisplayMode>('plain');
  const [showEnglish, setShowEnglish] = useState(false);
  const [chapterLayout, setChapterLayout] = useState(() => {
    try { return localStorage.getItem(GLOSS_LAYOUT_KEY) !== 'original'; } catch { return true; }
  });
  function changeChapterLayout(chapter: boolean) {
    setChapterLayout(chapter);
    try { localStorage.setItem(GLOSS_LAYOUT_KEY, chapter ? 'chapter' : 'original'); } catch { /* storage unavailable */ }
  }
  const [spaced, setSpaced] = useState('');
  const [chunks, setChunks] = useState<AnalysisChunk[]>([]);
  /** Guided walkthrough (Cure Dolly style): engine-first, one chunk at a time. Undefined outside a walkthrough. */
  const [wizardActive, setWizardActive] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const chunkWhyAttempted = useRef<Set<string>>(new Set());
  const [chunkWhyErrorIds, setChunkWhyErrorIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [translation, setTranslation] = useState('');
  const [readingOnly, setReadingOnly] = useState('');
  const [inlineReading, setInlineReading] = useState('');
  const [showReadingEdit, setShowReadingEdit] = useState(false);
  const [chunkError, setChunkError] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [customRoleIds, setCustomRoleIds] = useState<Set<string>>(new Set());
  const [dismissedSuggestionIds, setDismissedSuggestionIds] = useState<
    Set<string>
  >(new Set());
  const [heuristicPreview, setHeuristicPreview] = useState<{
    parts: string[];
    roles: string[];
    spaced: string;
  } | null>(null);
  const [confirmDeleteSentence, setConfirmDeleteSentence] = useState(false);
  const [deletingSentence, setDeletingSentence] = useState(false);
  const [confirmCompleteWithWarnings, setConfirmCompleteWithWarnings] =
    useState(false);

  const isCustomRole = (chunk: AnalysisChunk): boolean =>
    customRoleIds.has(chunk.id) ||
    (chunk.role !== '' && !ROLE_PRESET_SET.has(chunk.role));

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
    const sentenceVocabulary = await db.sentenceVocabulary
      .where('sentenceId')
      .equals(sentenceId)
      .toArray();
    // The preceding sentence or two, for context when glossing short lines
    // (especially conversational ones). Kept within the current chapter so
    // context doesn't bleed across a scene break.
    const currentChapterId =
      index >= 0 ? memberships[index]?.chapterId : undefined;
    const contextSentences =
      index > 0
        ? (
            await Promise.all(
              memberships
                .slice(Math.max(0, index - 2), index)
                .filter((item) => item.chapterId === currentChapterId)
                .map((item) => db.sentences.get(item.sentenceId)),
            )
          ).filter((item): item is Sentence => Boolean(item))
        : [];
    return {
      book,
      memberships,
      index,
      sentence,
      analysis,
      sentenceAudio,
      sentenceVocabulary,
      contextSentences,
    };
  }, [bookId, sentenceId]);

  useEffect(() => {
    if (!settings) return;
    setDisplayMode(settings.textDisplayMode);
    setShowEnglish(!settings.hideSatoriEnglishInitially);
  }, [settings]);

  useEffect(() => {
    if (!data?.sentence) return;
    setHydrated(false);
    const existing = data.analysis?.chunks ?? [];
    setChunks(existing);
    setCustomRoleIds(new Set());
    setDismissedSuggestionIds(new Set());
    setHeuristicPreview(null);
    setConfirmDeleteSentence(false);
    setConfirmCompleteWithWarnings(false);
    setNotes(data.analysis?.notes ?? '');
    setTranslation(data.sentence.translation ?? '');
    setReadingOnly(data.sentence.readingOnly ?? '');
    setInlineReading(data.sentence.inlineReading ?? '');
    setSpaced(initialSpacedText(data.sentence.japanese, existing));
    setHydrated(true);
    // Re-hydrate only when navigating to a different sentence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.sentence?.id]);

  const summary = useMemo(() => summarizeChunks(chunks), [chunks]);
  const openSuggestions = useMemo(() => {
    if (!data?.sentence) return [];
    return lintAnalysis(data.sentence.japanese, chunks, {
      translation: data.sentence.translation,
      vocabulary: data.sentence.targetVocabulary,
    }).filter((item) => !dismissedSuggestionIds.has(item.id));
  }, [chunks, data?.sentence, dismissedSuggestionIds]);
  const openWarnings = openSuggestions.filter(
    (item) => item.severity === 'warning',
  );
  // Guided walkthrough ordering: every engine chunk first (in their existing
  // relative order — most sentences have exactly one), then every other
  // chunk in original source order. Recomputed from live `chunks` rather
  // than frozen on wizard entry, so mid-walkthrough edits (e.g. relabeling
  // a chunk as the engine) are reflected immediately.
  const wizardOrder = useMemo(
    () => [
      ...chunks.filter((chunk) => isEngineRole(chunk.role)),
      ...chunks.filter((chunk) => !isEngineRole(chunk.role)),
    ],
    [chunks],
  );
  const wizardChunk = wizardActive ? wizardOrder[wizardStep] : undefined;
  const wizardRevealedIds = useMemo(
    () => new Set(wizardOrder.slice(0, wizardStep + 1).map((chunk) => chunk.id)),
    [wizardOrder, wizardStep],
  );
  // Vocabulary glosses per chunk (the sentence may still be mostly unknown
  // to the learner even once continue_book's gate has opened) — reuses
  // KaraokeSentenceText's own suggestion/target-vocabulary matching so the
  // walkthrough doesn't need a second gloss-resolution path.
  const sentenceTokens = useMemo(() => {
    if (!data?.sentence) return [];
    return buildSentenceTokens(
      data.sentence.japanese,
      data.sentence.vocabularySuggestions ?? [],
      data.sentence.targetVocabulary ?? [],
    );
  }, [data?.sentence]);
  function glossesForChunk(chunk: AnalysisChunk): { text: string; gloss: string }[] {
    if (chunk.kind === 'zero_ga') return [];
    const seen = new Set<string>();
    const results: { text: string; gloss: string }[] = [];
    for (const token of sentenceTokens) {
      if (!token.gloss || seen.has(token.text)) continue;
      if (!chunk.japanese.includes(token.text)) continue;
      seen.add(token.text);
      results.push({ text: token.text, gloss: token.gloss });
    }
    return results;
  }
  /** A chunk's hiragana reading, pulled out of the sentence's inlineReading markup — null when it can't be derived unambiguously (no inlineReading yet, a zero-が synthetic chunk, or a split mid-furigana-group). */
  function readingForChunk(chunk: AnalysisChunk): string | null {
    if (chunk.kind === 'zero_ga' || !data?.sentence) return null;
    return surfaceReadingFromInline(data.sentence.inlineReading, chunk.japanese);
  }
  const roleStats = useLiveQuery(
    () => getRoleOccurrenceStats(sentenceId),
    [sentenceId],
  );
  const roleCounts = useMemo(
    () =>
      new Map(
        [...(roleStats ?? new Map())].map(([role, entry]) => [role, entry.count]),
      ),
    [roleStats],
  );
  const speech = useJapaneseSpeech();
  const { stop: stopSpeech } = speech;
  const nativeAudio = useNativeAudio();
  const { stop: stopNativeAudio } = nativeAudio;

  // Cancel playback when navigating between sentences or leaving the editor.
  useEffect(
    () => () => {
      stopSpeech();
      stopNativeAudio();
    },
    [sentenceId, stopSpeech, stopNativeAudio],
  );

  const { saveState, saveNow } = useAutosave(
    {
      chunks,
      notes,
      translation,
      readingOnly,
      inlineReading,
    },
    async (value) => {
      await Promise.all([
        saveAnalysis(sentenceId, value.chunks, value.notes),
        updateSentenceText(sentenceId, {
          translation: value.translation,
          readingOnly: value.readingOnly,
          inlineReading: value.inlineReading,
        }),
      ]);
    },
    { enabled: hydrated },
  );

  // Auto-draft a "why this role here" explanation while the guided
  // walkthrough sits on a commonly-confused role with no note yet —
  // automatic rather than a manual button (user request, 2026-09-28), but
  // it still only ever pre-fills the same editable `notes` field a
  // hand-typed explanation would use. Unlike vocab-assist/grammar-assist,
  // a failure surfaces as a small inline note rather than failing silently.
  useEffect(() => {
    if (!hydrated || !wizardChunk || !data?.sentence) return;
    if (!AMBIGUITY_PRONE_ROLES.has(wizardChunk.role)) return;
    if (wizardChunk.notes?.trim()) return;
    if (chunkWhyAttempted.current.has(wizardChunk.id)) return;
    chunkWhyAttempted.current.add(wizardChunk.id);
    const chunkId = wizardChunk.id;
    const japanese = data.sentence.japanese;
    const context = chunks.map((item) => ({
      japanese: item.japanese,
      role: item.role,
      literalEnglish: item.literalEnglish,
    }));
    void (async () => {
      const result = await explainChunkWhy({
        sentence: japanese,
        chunk: {
          japanese: wizardChunk.japanese,
          role: wizardChunk.role,
          literalEnglish: wizardChunk.literalEnglish,
        },
        chunks: context,
      });
      if (result.ok) {
        setChunks((current) =>
          current.map((item) =>
            item.id === chunkId && !item.notes?.trim()
              ? { ...item, notes: result.explanation }
              : item,
          ),
        );
        void saveNow();
      } else {
        setChunkWhyErrorIds((current) => {
          const next = new Set(current);
          next.add(chunkId);
          return next;
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, wizardChunk, data?.sentence]);

  if (!data) return <p className="muted">Loading sentence…</p>;
  if (!data.sentence || !data.book) {
    // Loaded, but the row isn't on this device — e.g. a stale link to a
    // sentence that was deleted (ad/junk removal) here or on another device.
    return (
      <p className="muted">
        This sentence isn’t on this device — it may have been deleted.{' '}
        <Link to={data.book ? `/books/${bookId}` : '/books'}>
          Back to {data.book ? 'the book' : 'books'}
        </Link>
      </p>
    );
  }

  const { sentence, memberships, index, book, contextSentences } = data;
  const membership = index >= 0 ? memberships[index] : null;
  const chapterTitle = membership?.chapterId
    ? book.chapters?.find((chapter) => chapter.id === membership.chapterId)
        ?.title
    : undefined;
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

  function japaneseView() {
    if (displayMode === 'reading' && sentence.readingOnly) {
      return <div className="jp jp-lg">{sentence.readingOnly}</div>;
    }
    if (displayMode === 'furigana' && sentence.inlineReading) {
      return (
        <div className="jp jp-lg">
          <FuriganaText text={sentence.inlineReading} />
        </div>
      );
    }
    return <div className="jp jp-lg">{sentence.japanese}</div>;
  }

  function applySpaced(nextSpaced: string, force = false) {
    if (!data?.sentence) return;
    const result = applySpacedChunks(nextSpaced, data.sentence.japanese, chunks);
    if (!result.ok) {
      setChunkError(result.reason);
      return;
    }
    const discarded = countDiscardedAnnotations(chunks, result.chunks);
    if (!force && discarded >= 2) {
      const ok = window.confirm(
        `This edit would discard annotations on ${discarded} chunks. Continue?`,
      );
      if (!ok) return;
    }
    setChunkError('');
    setSpaced(nextSpaced);
    setChunks(result.chunks);
  }

  function applyHeuristicNow() {
    const nextChunks = applyHeuristicChunks(sentence.japanese, chunks);
    const discarded = countDiscardedAnnotations(chunks, nextChunks);
    if (discarded >= 2) {
      const ok = window.confirm(
        `Applying the heuristic would discard annotations on ${discarded} chunks. Continue?`,
      );
      if (!ok) return;
    }
    setChunks(nextChunks);
    setSpaced(surfaceJapaneseParts(nextChunks).join(' '));
    setChunkError('');
    setDismissedSuggestionIds(new Set());
    setHeuristicPreview(null);
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="muted">{book.title}</div>
            {chapterTitle ? (
              <div className="muted" style={{ fontSize: '0.9rem' }}>
                {chapterTitle}
              </div>
            ) : null}
            <strong>
              {index + 1} of {memberships.length}
            </strong>
          </div>
          <div className="row">
            <label>
              Layout
              <select value={chapterLayout ? 'chapter' : 'original'} onChange={(event) => changeChapterLayout(event.target.value === 'chapter')}>
                <option value="chapter">Chapter + icons</option>
                <option value="original">Original · sentence</option>
              </select>
            </label>
            {chapterLayout ? null : (<>
            <button
              type="button"
              disabled={!prev}
              onClick={() =>
                prev &&
                navigate(`/books/${bookId}/analyze/${prev.sentenceId}`)
              }
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!next}
              onClick={() =>
                next &&
                navigate(`/books/${bookId}/analyze/${next.sentenceId}`)
              }
            >
              Next
            </button>
            <Link to={`/books/${bookId}/vocabulary/${sentenceId}`}>
              <button type="button" className="ghost">
                Vocabulary
              </button>
            </Link>
            <Link to={`/books/${bookId}`}>
              <button type="button" className="ghost">
                Book
              </button>
            </Link>
            </>)}
          </div>
        </div>
        {chapterLayout ? (
          <>
        <div className="gloss-workbench">
          <ChapterReader
            sentenceId={sentenceId}
            bookId={bookId}
            showEnglish={showEnglish}
            onOpen={(id) => navigate(`/books/${bookId}/analyze/${id}`)}
            activeView={japaneseView()}
            fallbackContext={contextSentences}
          />
          <div className="gloss-rail" role="toolbar" aria-label="Sentence tools" aria-orientation="vertical">
            <button type="button" className="icon-button" aria-label="Previous sentence" title="Previous sentence" disabled={!prev}
              onClick={() => prev && navigate(`/books/${bookId}/analyze/${prev.sentenceId}`)}>←</button>
            <button type="button" className="icon-button" aria-label="Next sentence" title="Next sentence" disabled={!next}
              onClick={() => next && navigate(`/books/${bookId}/analyze/${next.sentenceId}`)}>→</button>
            <button type="button" className="icon-button" aria-label={`Save (${saveState === 'saving' ? 'saving' : saveState === 'saved' ? 'saved' : saveState === 'failed' ? 'save failed' : saveState === 'dirty' ? 'unsaved changes' : 'ready'})`}
              title={saveState === 'dirty' ? 'Save (unsaved changes)' : saveState === 'failed' ? 'Save failed — try again' : saveState === 'saving' ? 'Saving…' : 'Save'}
              data-state={saveState} onClick={() => void saveNow()}>{saveState === 'saved' ? '✓' : '💾'}</button>
            <span className="sr-only" role="status">
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'failed' ? 'Save failed' : saveState === 'dirty' ? 'Unsaved' : 'Ready'}
            </span>
            <button type="button" className="icon-button" aria-label={`Text: ${TEXT_MODE_LABELS[displayMode]}. Switch display`}
              title={`Text: ${TEXT_MODE_LABELS[displayMode]} (tap for ${TEXT_MODE_LABELS[TEXT_MODE_ORDER[(TEXT_MODE_ORDER.indexOf(displayMode) + 1) % TEXT_MODE_ORDER.length]!]})`}
              onClick={() => setDisplayMode(TEXT_MODE_ORDER[(TEXT_MODE_ORDER.indexOf(displayMode) + 1) % TEXT_MODE_ORDER.length]!)}>
              {displayMode === 'plain' ? '文' : displayMode === 'furigana' ? 'ふ' : 'あ'}
            </button>
            <button type="button" className="icon-button" aria-pressed={showEnglish}
              aria-label={`${showEnglish ? 'Hide' : 'Show'} Satori English`} title={`${showEnglish ? 'Hide' : 'Show'} Satori English`}
              onClick={() => setShowEnglish((value) => !value)}>EN</button>
            <button type="button" className="icon-button" aria-pressed={showReadingEdit}
              aria-label={`${showReadingEdit ? 'Hide' : 'Edit'} reading`} title={`${showReadingEdit ? 'Hide' : 'Edit'} reading`}
              onClick={() => setShowReadingEdit((value) => !value)}>✎</button>
            {orderedAudio.map((audio, audioIndex) => (
              <NativeAudioButton key={audio.id} audio={audio} iconOnly hideAdjust
                displayLabel={orderedAudio.length > 1 ? `Native ${audioIndex + 1}` : undefined} />
            ))}
            <SpeakButton text={sentence.japanese} itemId={`sentence-${sentence.id}`}
              label="Play Japanese sentence with device TTS" iconOnly />
            <a className="icon-button" href={ichiMoeUrl(sentence.japanese)} target="_blank" rel="noreferrer"
              aria-label="Open in ichi.moe" title="Open in ichi.moe">🔍</a>
            <Link className="icon-button" to={`/books/${bookId}/vocabulary/${sentenceId}`}
              aria-label="Vocabulary for this sentence" title="Vocabulary for this sentence">語</Link>
            <Link className="icon-button" to={`/books/${bookId}`} aria-label="Back to book" title="Back to book">📖</Link>
          </div>
        </div>
          </>
        ) : (
          <>
        {contextSentences.length > 0 ? (
          <div
            className="stack"
            style={{ gap: '0.2rem', opacity: 0.6, marginBottom: '0.25rem' }}
          >
            <div className="muted" style={{ fontSize: '0.75rem' }}>
              {contextSentences.length === 1
                ? 'Preceding sentence'
                : 'Preceding sentences'}
            </div>
            {contextSentences.map((context) => (
              <div key={context.id}>
                <div className="jp">{context.japanese}</div>
                {showEnglish && context.translation ? (
                  <div className="muted" style={{ fontSize: '0.85rem' }}>
                    {context.translation}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {japaneseView()}
        <div className="row">
          <label>
            Text
            <select
              value={displayMode}
              onChange={(event) =>
                setDisplayMode(event.target.value as TextDisplayMode)
              }
            >
              <option value="plain">Plain Japanese</option>
              <option value="furigana">Furigana</option>
              <option value="reading">Reading-only</option>
            </select>
          </label>
          <button type="button" onClick={() => setShowEnglish((value) => !value)}>
            {showEnglish ? 'Hide' : 'Show'} Satori English
          </button>
          <button type="button" onClick={() => setShowReadingEdit((value) => !value)}>
            {showReadingEdit ? 'Hide' : 'Edit'} reading
          </button>
          <a href={ichiMoeUrl(sentence.japanese)} target="_blank" rel="noreferrer">
            ichi.moe
          </a>
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
          <button type="button" onClick={() => void saveNow()}>
            Save
          </button>
        </div>
          </>
        )}
        {!speech.supported ? (
          <p className="muted" style={{ margin: 0 }}>
            Device TTS is unavailable: this browser does not support speech
            synthesis. Imported native recordings can still play.
          </p>
        ) : null}
        {nativeAudio.error ? (
          <p style={{ margin: 0, color: 'var(--danger)' }} role="alert">
            {nativeAudio.error}
          </p>
        ) : null}
        {data.book?.sourceUrl
          ? orderedAudio.map((audio, audioIndex) => (
              <SentenceAudioAdjuster
                key={`adjust-${audio.id}`}
                audio={audio}
                sourceUrl={audio.sourceUrl ?? data.book!.sourceUrl!}
                label={
                  orderedAudio.length > 1
                    ? `Adjust clip ${audioIndex + 1}`
                    : 'Adjust clip timing'
                }
              />
            ))
          : null}
        <VocabChips items={sentence.targetVocabulary} />
        <WordAudioSection
          japanese={sentence.japanese}
          inlineReading={sentence.inlineReading}
          audio={orderedAudio[0]}
          links={data.sentenceVocabulary ?? []}
        />
        {showEnglish ? (
          <div className="panel stack" style={{ boxShadow: 'none' }}>
            <label className="muted" htmlFor="sentence-translation">
              Satori English
            </label>
            <textarea
              id="sentence-translation"
              value={translation}
              onChange={(event) => setTranslation(event.target.value)}
              onBlur={() => void saveNow()}
              placeholder="English translation…"
              rows={2}
            />
          </div>
        ) : null}
        {showReadingEdit ? (
          <div className="panel stack" style={{ boxShadow: 'none' }}>
            <p className="muted" style={{ margin: 0 }}>
              Correct the kana reading used for Reading-only display, furigana,
              and shadowing's mora breakdown — e.g. when a numeral like "22"
              is missing its reading (にじゅうに). Leave a field blank to fall
              back to the other one.
            </p>
            <label className="muted" htmlFor="sentence-reading-only">
              Reading-only (kana)
            </label>
            <textarea
              id="sentence-reading-only"
              className="jp"
              value={readingOnly}
              onChange={(event) => setReadingOnly(event.target.value)}
              onBlur={() => void saveNow()}
              placeholder="Whole-sentence kana reading…"
              rows={2}
            />
            <label className="muted" htmlFor="sentence-inline-reading">
              Inline reading ({'word[reading]'} markup)
            </label>
            <textarea
              id="sentence-inline-reading"
              className="jp"
              value={inlineReading}
              onChange={(event) => setInlineReading(event.target.value)}
              onBlur={() => void saveNow()}
              placeholder="例[れい]の様[よう]に単語[たんご]ごとに読み方[よみかた]を付ける…"
              rows={2}
            />
          </div>
        ) : null}
      </section>

      <GrammarPicker
        sentenceId={sentenceId}
        japanese={sentence.japanese}
        chunks={chunks.map((chunk) => ({
          japanese: chunk.japanese,
          role: chunk.role,
          literalEnglish: chunk.literalEnglish,
        }))}
      />

      <ComprehensionCheckPicker sentenceId={sentenceId} />

      <section className="panel stack">
        <h3 style={{ margin: 0 }}>Chunk entry</h3>
        <p className="muted" style={{ margin: 0 }}>
          Spaces define chunk boundaries. Non-space Japanese characters should
          stay unchanged.
        </p>
        <textarea
          aria-label="Chunk spaced Japanese"
          className="jp"
          value={spaced}
          onChange={(event) => {
            const nextValue = event.target.value;
            setSpaced(nextValue);
            const stripped = nextValue.replace(/\s+/g, '');
            const source = sentence.japanese.replace(/\s+/g, '');
            if (stripped !== source) {
              setChunkError(
                'Non-space characters no longer match the source sentence.',
              );
              return;
            }
            applySpaced(nextValue);
          }}
          onBlur={() => {
            applySpaced(spaced);
            void saveNow();
          }}
        />
        {chunkError ? (
          <div style={{ color: 'var(--danger)' }}>{chunkError}</div>
        ) : null}
        <div className="row">
          <button
            type="button"
            onClick={() => {
              setSpaced(sentence.japanese);
              setChunks([]);
              setChunkError('');
              setHeuristicPreview(null);
            }}
          >
            Reset to original sentence
          </button>
          <button
            type="button"
            onClick={() => {
              setHeuristicPreview(previewHeuristicChunks(sentence.japanese));
              setChunkError('');
            }}
          >
            Preview heuristic
          </button>
          <button type="button" onClick={() => applyHeuristicNow()}>
            Apply heuristic chunking
          </button>
        </div>
        {heuristicPreview ? (
          <div className="panel stack" style={{ boxShadow: 'none' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>
                Heuristic preview ({heuristicPreview.parts.length} chunks)
              </strong>
              <button
                type="button"
                className="ghost"
                onClick={() => setHeuristicPreview(null)}
              >
                Hide
              </button>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              Suggested boundaries and roles only — your current chunks are
              unchanged until you apply.
            </p>
            <div className="jp" style={{ fontSize: '1.05rem' }}>
              {heuristicPreview.spaced}
            </div>
            <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
              {heuristicPreview.parts.map((part, index) => (
                <li key={`${index}-${part}`}>
                  <span className="jp">{part}</span>
                  <span className="muted">
                    {' '}
                    · {heuristicPreview.roles[index] || '—'}
                  </span>
                </li>
              ))}
            </ol>
            <div className="row">
              <button
                type="button"
                className="primary"
                onClick={() => applyHeuristicNow()}
              >
                Apply this heuristic
              </button>
              <button type="button" onClick={() => setHeuristicPreview(null)}>
                Keep my chunks
              </button>
            </div>
          </div>
        ) : null}
        <label className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={hasZeroGaSubject(chunks)}
            onChange={(event) => {
              setChunks(
                event.target.checked
                  ? addZeroGaSubject(chunks)
                  : removeZeroGaSubject(chunks),
              );
            }}
          />
          <span>
            Add zero-が (∅) subject — not part of the source sentence; use for
            invisible noga practice
          </span>
        </label>
        <details>
          <summary>Role guide (Cure Dolly–style)</summary>
          <p className="muted" style={{ margin: '0.5rem 0' }}>
            Short meanings for the role dropdown. Prefer{' '}
            <strong>clause connector</strong> for そして / しかし — not て-car
            (that is for verb て-form links).
          </p>
          <RoleGuideContent compact counts={roleCounts} />
        </details>
      </section>

      <section className="stack">
        {chunks.length ? (
          <>
            <ChunkPuzzleStrip
              chunks={chunks}
              activeItemId={
                wizardChunk
                  ? `chunk-${wizardChunk.id}`
                  : speech.isSpeaking
                    ? speech.activeItemId
                    : null
              }
              revealRoles
              showLegend
              revealedIds={wizardActive ? wizardRevealedIds : undefined}
            />
            <div className="row">
              <button
                type="button"
                disabled={!speech.supported}
                onClick={() =>
                  speech.speakSequence(
                    chunks
                      .filter((chunk) =>
                        chunkHasSpeakableJapanese(chunk.japanese),
                      )
                      .map((chunk) => ({
                        itemId: `chunk-${chunk.id}`,
                        text: chunk.japanese,
                      })),
                  )
                }
              >
                Play by chunks
              </button>
              {speech.isSpeaking ? (
                <button type="button" onClick={() => speech.stop()}>
                  Stop audio
                </button>
              ) : null}
              {!wizardActive ? (
                <button
                  type="button"
                  onClick={() => {
                    setWizardStep(0);
                    setWizardActive(true);
                  }}
                >
                  Guided walkthrough (Cure Dolly style)
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              applyHeuristicNow();
              setWizardStep(0);
              setWizardActive(true);
            }}
          >
            Start guided walkthrough
          </button>
        )}
        {wizardActive && wizardChunk ? (
          <div className="panel stack" aria-label="Guided walkthrough">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>
                Step {wizardStep + 1} of {wizardOrder.length}
                {isEngineRole(wizardChunk.role) ? ' — find the engine first' : ''}
              </strong>
              <button
                type="button"
                className="ghost"
                onClick={() => setWizardActive(false)}
              >
                Exit walkthrough
              </button>
            </div>
            <div className="jp jp-lg">{wizardChunk.japanese}</div>
            {readingForChunk(wizardChunk) ? (
              <div className="jp muted jp-sm">{readingForChunk(wizardChunk)}</div>
            ) : null}
            {glossesForChunk(wizardChunk).length ? (
              <p className="muted" style={{ margin: 0 }}>
                {glossesForChunk(wizardChunk)
                  .map((item) => `${item.text} — ${item.gloss}`)
                  .join(' · ')}
              </p>
            ) : null}
            <p style={{ margin: 0 }}>
              {roleGuideBlurb(wizardChunk.role) ??
                (wizardChunk.role.trim()
                  ? wizardChunk.role
                  : 'What role does this play — is it the engine, or is it marked by a particle as one of its cars?')}
            </p>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              Set (or correct) its role and literal English below, then
              confirm to move on.
            </p>
            <div className="row">
              <button
                type="button"
                disabled={wizardStep === 0}
                onClick={() => setWizardStep((step) => Math.max(0, step - 1))}
              >
                ◀ Back
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  if (wizardStep >= wizardOrder.length - 1) {
                    setWizardActive(false);
                    return;
                  }
                  setWizardStep((step) => step + 1);
                }}
              >
                {wizardStep >= wizardOrder.length - 1
                  ? 'Confirm & finish'
                  : 'Confirm & next'}
              </button>
            </div>
          </div>
        ) : null}
        {chunks.map((chunk, chunkIndex) => {
          const zeroGa = isZeroGaChunk(chunk);
          return (
          <article
            key={chunk.id}
            className={`chunk-card${
              (speech.isSpeaking && speech.activeItemId === `chunk-${chunk.id}`) ||
              wizardChunk?.id === chunk.id
                ? ' speaking-chunk'
                : ''
            }`}
          >
            <div className="row" style={{ justifyContent: 'space-between' }}>
              {zeroGa ? (
                <label style={{ flex: 1 }}>
                  <span className="muted">Zero-が Japanese (editable)</span>
                  <input
                    className="jp jp-lg"
                    value={chunk.japanese}
                    onChange={(event) => {
                      const value = event.target.value;
                      setChunks((current) =>
                        current.map((item) =>
                          item.id === chunk.id
                            ? { ...item, japanese: value }
                            : item,
                        ),
                      );
                    }}
                    onBlur={() => void saveNow()}
                  />
                </label>
              ) : (
                <strong className="jp jp-lg">{chunk.japanese}</strong>
              )}
              <span className="row" style={{ gap: '0.4rem' }}>
                {chunkHasSpeakableJapanese(chunk.japanese) ? (
                  <SpeakButton
                    text={chunk.japanese}
                    itemId={`chunk-${chunk.id}`}
                    label={`Play Japanese chunk: ${chunk.japanese}`}
                    compact
                  />
                ) : null}
                <span className="muted">#{chunkIndex + 1}</span>
              </span>
            </div>
            {readingForChunk(chunk) ? (
              <div className="jp muted jp-sm">{readingForChunk(chunk)}</div>
            ) : null}
            {zeroGa ? (
              <div className="status-pill">zero-が · not in source</div>
            ) : null}
            <label>
              Role
              <select
                value={
                  isCustomRole(chunk) ? CUSTOM_ROLE_VALUE : chunk.role
                }
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === CUSTOM_ROLE_VALUE) {
                    setCustomRoleIds((current) => {
                      const next = new Set(current);
                      next.add(chunk.id);
                      return next;
                    });
                    return;
                  }
                  setCustomRoleIds((current) => {
                    if (!current.has(chunk.id)) return current;
                    const next = new Set(current);
                    next.delete(chunk.id);
                    return next;
                  });
                  setChunks((current) =>
                    current.map((item) =>
                      item.id === chunk.id ? { ...item, role: value } : item,
                    ),
                  );
                }}
                onBlur={() => void saveNow()}
              >
                <option value="">— choose role —</option>
                {ROLE_PRESET_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.roles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value={CUSTOM_ROLE_VALUE}>Custom…</option>
              </select>
            </label>
            {isCustomRole(chunk) ? (
              <label>
                Custom role
                <input
                  value={chunk.role}
                  placeholder="e.g. counter expression"
                  onChange={(event) => {
                    const value = event.target.value;
                    setChunks((current) =>
                      current.map((item) =>
                        item.id === chunk.id ? { ...item, role: value } : item,
                      ),
                    );
                  }}
                  onBlur={() => void saveNow()}
                />
              </label>
            ) : null}
            <label>
              Literal sticky English
              <textarea
                value={chunk.literalEnglish}
                onChange={(event) => {
                  const value = event.target.value;
                  setChunks((current) =>
                    current.map((item) =>
                      item.id === chunk.id
                        ? { ...item, literalEnglish: value }
                        : item,
                    ),
                  );
                }}
                onBlur={() => void saveNow()}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                const suggested = suggestStickyEnglish(chunk.japanese, {
                  role: chunk.role,
                  englishHint: sentence.translation,
                  vocabulary: sentence.targetVocabulary,
                });
                if (!suggested) return;
                setChunks((current) =>
                  current.map((item) =>
                    item.id === chunk.id
                      ? { ...item, literalEnglish: suggested }
                      : item,
                  ),
                );
              }}
            >
              Suggest sticky English
            </button>
            <label>
              Why this role here?
              <textarea
                value={chunk.notes ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setChunks((current) =>
                    current.map((item) =>
                      item.id === chunk.id
                        ? { ...item, notes: value || undefined }
                        : item,
                    ),
                  );
                }}
                onBlur={() => void saveNow()}
                placeholder={
                  roleGuideBlurb(chunk.role) ??
                  'Why does this chunk have this role in this sentence?'
                }
              />
            </label>
            {chunkWhyErrorIds.has(chunk.id) && !chunk.notes?.trim() ? (
              <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                Couldn&rsquo;t get an AI explanation here (offline or
                unavailable) — feel free to write one yourself.
              </p>
            ) : null}
            {roleGuideCallout(chunk.role, roleStats)}
            <div className="row">
              <button
                type="button"
                disabled={chunkIndex === 0}
                onClick={() => setChunks(moveChunk(chunks, chunk.id, 'up'))}
              >
                Move up
              </button>
              <button
                type="button"
                disabled={chunkIndex >= chunks.length - 1}
                onClick={() => setChunks(moveChunk(chunks, chunk.id, 'down'))}
              >
                Move down
              </button>
              {!zeroGa ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const offset = Math.floor(chunk.japanese.length / 2);
                      setChunks(splitChunkAt(chunks, chunk.id, offset));
                    }}
                  >
                    Split
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setChunks(
                        mergeChunkWithNeighbor(chunks, chunk.id, 'previous'),
                      )
                    }
                  >
                    Merge prev
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setChunks(mergeChunkWithNeighbor(chunks, chunk.id, 'next'))
                    }
                  >
                    Merge next
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setChunks(
                        moveChunkBoundary(
                          chunks,
                          chunk.id,
                          'left',
                          sentence.japanese,
                        ),
                      )
                    }
                  >
                    Boundary ←
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setChunks(
                        moveChunkBoundary(
                          chunks,
                          chunk.id,
                          'right',
                          sentence.japanese,
                        ),
                      )
                    }
                  >
                    Boundary →
                  </button>
                </>
              ) : null}
            </div>
          </article>
          );
        })}
      </section>

      {chunks.length ? (
        <section className="panel stack" aria-label="Review suggestions">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>
              Review suggestions ({openSuggestions.length})
            </h3>
            {dismissedSuggestionIds.size ? (
              <button
                type="button"
                className="ghost"
                onClick={() => setDismissedSuggestionIds(new Set())}
              >
                Restore dismissed
              </button>
            ) : null}
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Local checks against Cure Dolly–style heuristics and sticky-English
            habits. Suggestions never overwrite your gloss unless you apply
            them.
          </p>
          {!openSuggestions.length ? (
            <div className="status-pill complete">No open suggestions</div>
          ) : (
            <div className="stack">
              {openSuggestions.map((suggestion) => (
                <article
                  key={suggestion.id}
                  className={`suggestion-card ${suggestion.severity}`}
                >
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong>
                      {suggestion.severity === 'warning' ? 'Check' : 'Tip'}
                    </strong>
                    {typeof suggestion.chunkIndex === 'number' ? (
                      <span className="muted">
                        Chunk #{suggestion.chunkIndex + 1}
                      </span>
                    ) : null}
                  </div>
                  <p style={{ margin: 0 }}>{suggestion.message}</p>
                  <div className="row">
                    {suggestion.action !== 'none' ? (
                      <button
                        type="button"
                        className="primary"
                        onClick={() => {
                          if (suggestion.action === 'reapply_heuristic') {
                            const nextChunks = applyHeuristicChunks(
                              sentence.japanese,
                              chunks,
                            );
                            const discarded = countDiscardedAnnotations(
                              chunks,
                              nextChunks,
                            );
                            if (discarded >= 2) {
                              const ok = window.confirm(
                                `Applying the heuristic would discard annotations on ${discarded} chunks. Continue?`,
                              );
                              if (!ok) return;
                            }
                            setChunks(nextChunks);
                            setSpaced(
                              nextChunks
                                .map((chunk) => chunk.japanese)
                                .join(' '),
                            );
                            setChunkError('');
                            setDismissedSuggestionIds(new Set());
                            return;
                          }
                          setChunks(
                            applySuggestion(
                              suggestion,
                              sentence.japanese,
                              chunks,
                              applyHeuristicChunks,
                            ),
                          );
                          setDismissedSuggestionIds((current) => {
                            const next = new Set(current);
                            next.add(suggestion.id);
                            return next;
                          });
                        }}
                      >
                        {suggestion.action === 'apply_role'
                          ? `Use “${suggestion.suggestedRole}”`
                          : suggestion.action === 'apply_lit'
                            ? `Use “${suggestion.suggestedLiteral}”`
                            : 'Apply heuristic chunks'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        setDismissedSuggestionIds((current) => {
                          const next = new Set(current);
                          next.add(suggestion.id);
                          return next;
                        })
                      }
                    >
                      Dismiss
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className="panel stack">
        <h3 style={{ margin: 0 }}>Summary</h3>
        <div className="summary-lines">
          {`CHUNK: ${summary.chunk}\nROLE: ${summary.role}\nLIT: ${summary.lit}`}
        </div>
        <label>
          Notes
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            onBlur={() => void saveNow()}
          />
        </label>
        <div className="row" style={{ alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            Sentence status:
          </span>
          <span className={`status-pill ${membership?.status ?? 'unstarted'}`}>
            {SENTENCE_STATUS_LABEL[membership?.status ?? 'unstarted'] ??
              'Not started'}
          </span>
        </div>
        <div className="row">
          <button
            type="button"
            className={membership?.status === 'in_progress' ? 'primary' : undefined}
            aria-pressed={membership?.status === 'in_progress'}
            onClick={async () => {
              await setBookSentenceStatus(bookId, sentenceId, 'in_progress');
            }}
          >
            Mark in progress
          </button>
          <button
            type="button"
            className={membership?.status === 'complete' ? 'primary' : undefined}
            aria-pressed={membership?.status === 'complete'}
            onClick={async () => {
              if (openWarnings.length && !confirmCompleteWithWarnings) {
                setConfirmCompleteWithWarnings(true);
                return;
              }
              await saveNow();
              await setBookSentenceStatus(bookId, sentenceId, 'complete');
              setConfirmCompleteWithWarnings(false);
            }}
          >
            Mark complete
          </button>
          <button
            type="button"
            className={membership?.status === 'needs_review' ? 'primary' : undefined}
            aria-pressed={membership?.status === 'needs_review'}
            onClick={async () => {
              await setBookSentenceStatus(bookId, sentenceId, 'needs_review');
            }}
          >
            Needs review
          </button>
          <button
            type="button"
            onClick={async () => {
              const text = formatWorksheetBlock({
                sentence,
                chunks,
                index: index + 1,
                sourceLabel: book.title,
              });
              await copyText(text);
            }}
          >
            Copy worksheet
          </button>
          <button
            type="button"
            onClick={async () => {
              const text = formatWorksheetBlock({
                sentence,
                chunks,
                index: index + 1,
                sourceLabel: book.title,
              });
              const shared = await shareText('Worksheet', text);
              if (!shared) {
                downloadText('worksheet.txt', text, 'text/plain');
              }
            }}
          >
            Share / download
          </button>
          <Link to={`/books/${bookId}/practice/${sentenceId}`}>
            <button type="button">Practice this</button>
          </Link>
          <Link to={`/books/${bookId}/build/${sentenceId}`}>
            <button type="button">Build this</button>
          </Link>
        </div>
        {confirmCompleteWithWarnings ? (
          <p style={{ margin: 0, color: 'var(--warning)' }} role="alert">
            {openWarnings.length} review warning(s) are still open. Press “Mark
            complete” again to complete anyway.
          </p>
        ) : null}
      </section>

      <section className="panel stack">
        <h3 style={{ margin: 0 }}>Danger zone</h3>
        <p className="muted" style={{ margin: 0 }}>
          Deletes this sentence everywhere: its analysis, vocabulary and grammar
          links, book membership, and any sentence-level study progress. Confirmed
          vocabulary and kanji stay in your library.
        </p>
        {confirmDeleteSentence ? (
          <div className="row">
            <button
              type="button"
              className="danger"
              disabled={deletingSentence}
              onClick={async () => {
                setDeletingSentence(true);
                try {
                  await deleteSentenceCascade(sentenceId);
                  navigate(`/books/${bookId}`);
                } catch (error) {
                  setDeletingSentence(false);
                  window.alert(
                    error instanceof Error ? error.message : String(error),
                  );
                }
              }}
            >
              {deletingSentence ? 'Deleting…' : 'Confirm delete'}
            </button>
            <button
              type="button"
              disabled={deletingSentence}
              onClick={() => setConfirmDeleteSentence(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="row">
            <button
              type="button"
              className="danger"
              onClick={() => setConfirmDeleteSentence(true)}
            >
              Delete sentence
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Per-word native-audio isolate + span-adjust, mirroring the control the
 * `pitch_accent` / `word_listening` review cards show at reveal
 * (SegmentLoopPlayer). Surfaced here so a mis-aligned word span reported
 * from a review card can be corrected on the sentence itself rather than
 * only mid-review — the "Adjust" editor persists to the same
 * `SentenceVocabulary.audioStartMs/EndMs` override.
 */
function WordAudioSection({
  japanese,
  inlineReading,
  audio,
  links,
}: {
  japanese: string;
  inlineReading?: string;
  audio: SentenceAudio | undefined;
  links: SentenceVocabulary[];
}) {
  if (!audio) return null;
  const seen = new Set<string>();
  const wordLinks = links.filter((link) => {
    const surface = link.surfaceForm?.trim();
    if (!surface || seen.has(surface)) return false;
    seen.add(surface);
    return true;
  });
  if (wordLinks.length === 0) return null;

  return (
    <div className="panel stack" style={{ boxShadow: 'none' }}>
      <label className="muted" style={{ margin: 0 }}>
        Native word audio — loop one word from the recording, or drag its span
        if the auto-alignment picked the wrong slice (this is the same
        &ldquo;Adjust&rdquo; a pitch-accent review card offers).
      </label>
      {wordLinks.map((link) => (
        <div key={link.id} className="stack" style={{ gap: '0.25rem' }}>
          <div className="jp">{link.surfaceForm}</div>
          <SegmentLoopPlayer
            audio={audio}
            japanese={japanese}
            inlineReading={inlineReading}
            surfaceForm={link.surfaceForm ?? ''}
            link={link}
          />
        </div>
      ))}
    </div>
  );
}
