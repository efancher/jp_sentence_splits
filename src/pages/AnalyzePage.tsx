import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ROLE_PRESET_GROUPS, ROLE_PRESETS } from '../appConfig';
import { NativeAudioButton } from '../components/NativeAudioButton';
import { SpeakButton } from '../components/SpeakButton';
import { VocabChips } from '../components/VocabChips';
import { readSettings } from '../db/database';
import {
  getDb,
  saveAnalysis,
  setBookSentenceStatus,
} from '../db/repository';
import type { AnalysisChunk, TextDisplayMode } from '../domain/types';
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
  removeZeroGaSubject,
  splitChunkAt,
  surfaceJapaneseParts,
} from '../lib/analysisHelpers';
import {
  applySuggestion,
  lintAnalysis,
} from '../lib/analysisSuggestions';
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

export function AnalyzePage() {
  const { bookId = '', sentenceId = '' } = useParams();
  const navigate = useNavigate();
  const settings = useLiveQuery(() => readSettings(), []);
  const [displayMode, setDisplayMode] = useState<TextDisplayMode>('plain');
  const [showEnglish, setShowEnglish] = useState(false);
  const [spaced, setSpaced] = useState('');
  const [chunks, setChunks] = useState<AnalysisChunk[]>([]);
  const [notes, setNotes] = useState('');
  const [chunkError, setChunkError] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [customRoleIds, setCustomRoleIds] = useState<Set<string>>(new Set());
  const [dismissedSuggestionIds, setDismissedSuggestionIds] = useState<
    Set<string>
  >(new Set());

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
    return { book, memberships, index, sentence, analysis, sentenceAudio };
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
    setNotes(data.analysis?.notes ?? '');
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
    { chunks, notes },
    async (value) => {
      await saveAnalysis(sentenceId, value.chunks, value.notes);
    },
    { enabled: hydrated },
  );

  if (!data?.sentence || !data.book) {
    return <p className="muted">Loading sentence…</p>;
  }

  const { sentence, memberships, index, book } = data;
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
            <Link to={`/books/${bookId}`}>
              <button type="button" className="ghost">
                Book
              </button>
            </Link>
          </div>
        </div>
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
        <VocabChips items={sentence.targetVocabulary} />
        {showEnglish ? (
          <div className="panel" style={{ boxShadow: 'none' }}>
            <div className="muted">Satori English</div>
            <div>{sentence.translation || '(none)'}</div>
          </div>
        ) : null}
      </section>

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
            }}
          >
            Reset to original sentence
          </button>
          <button
            type="button"
            onClick={() => {
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
            }}
          >
            Apply heuristic chunking
          </button>
        </div>
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
      </section>

      <section className="stack">
        {chunks.length ? (
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
          </div>
        ) : null}
        {chunks.map((chunk, chunkIndex) => {
          const zeroGa = isZeroGaChunk(chunk);
          return (
          <article
            key={chunk.id}
            className={`chunk-card${
              speech.isSpeaking && speech.activeItemId === `chunk-${chunk.id}`
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
        <div className="row">
          <button
            type="button"
            onClick={async () => {
              await setBookSentenceStatus(bookId, sentenceId, 'in_progress');
            }}
          >
            Mark in progress
          </button>
          <button
            type="button"
            className="primary"
            onClick={async () => {
              if (openWarnings.length) {
                const ok = window.confirm(
                  `${openWarnings.length} review warning(s) are still open. Mark complete anyway?`,
                );
                if (!ok) return;
              }
              await saveNow();
              await setBookSentenceStatus(bookId, sentenceId, 'complete');
            }}
          >
            Mark complete
          </button>
          <button
            type="button"
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
        </div>
      </section>
    </div>
  );
}
