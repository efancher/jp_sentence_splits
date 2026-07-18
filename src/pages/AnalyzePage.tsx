import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ROLE_PRESET_GROUPS, ROLE_PRESETS } from '../appConfig';
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
  applyHeuristicChunks,
  applySpacedChunks,
  countDiscardedAnnotations,
  initialSpacedText,
  mergeChunkWithNeighbor,
  moveChunkBoundary,
  splitChunkAt,
} from '../lib/analysisHelpers';
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
    return { book, memberships, index, sentence, analysis };
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
    setNotes(data.analysis?.notes ?? '');
    setSpaced(initialSpacedText(data.sentence.japanese, existing));
    setHydrated(true);
    // Re-hydrate only when navigating to a different sentence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.sentence?.id]);

  const summary = useMemo(() => summarizeChunks(chunks), [chunks]);
  const speech = useJapaneseSpeech();
  const { stop: stopSpeech } = speech;

  // Cancel playback when navigating between sentences or leaving the editor.
  useEffect(() => stopSpeech, [sentenceId, stopSpeech]);

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
          <SpeakButton
            text={sentence.japanese}
            itemId={`sentence-${sentence.id}`}
            label="Play Japanese sentence"
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
            Audio playback is unavailable: this browser does not support
            speech synthesis.
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
              setChunks(nextChunks);
              setSpaced(nextChunks.map((chunk) => chunk.japanese).join(' '));
              setChunkError('');
            }}
          >
            Apply heuristic chunking
          </button>
        </div>
      </section>

      <section className="stack">
        {chunks.length ? (
          <div className="row">
            <button
              type="button"
              disabled={!speech.supported}
              onClick={() =>
                speech.speakSequence(
                  chunks.map((chunk) => ({
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
        {chunks.map((chunk, chunkIndex) => (
          <article
            key={chunk.id}
            className={`chunk-card${
              speech.isSpeaking && speech.activeItemId === `chunk-${chunk.id}`
                ? ' speaking-chunk'
                : ''
            }`}
          >
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong className="jp">{chunk.japanese}</strong>
              <span className="row" style={{ gap: '0.4rem' }}>
                <SpeakButton
                  text={chunk.japanese}
                  itemId={`chunk-${chunk.id}`}
                  label={`Play Japanese chunk: ${chunk.japanese}`}
                  compact
                />
                <span className="muted">#{chunkIndex + 1}</span>
              </span>
            </div>
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
            <div className="row">
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
                  setChunks(mergeChunkWithNeighbor(chunks, chunk.id, 'previous'))
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
                    moveChunkBoundary(chunks, chunk.id, 'left', sentence.japanese),
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
            </div>
          </article>
        ))}
      </section>

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
