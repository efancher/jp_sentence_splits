import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { KaraokeSentenceText } from '../components/KaraokeSentenceText';
import { getDb, readSettings } from '../db/repository';
import type { BookSentence, Sentence, SentenceAudio, TextDisplayMode } from '../domain/types';
import { useNativeAudio } from '../hooks/useNativeAudio';
import { FuriganaText } from '../lib/furigana';
import { PLAYBACK_SPEEDS } from '../lib/recording';

/**
 * Always-available, non-graded chapter/book read-along (2026-09-23 roadmap
 * idea, un-gated per user request 2026-09-26 — no vocabulary-coverage
 * unlock, just an occasional comprehension self-check). Not a card: no
 * `Review` row, no FSRS, no self-rating, same treatment as `ShadowPage`/`/play`.
 */
export function ReaderPage() {
  const { bookId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const chapterId = searchParams.get('chapter') || undefined;
  const native = useNativeAudio();
  const settings = useLiveQuery(() => readSettings(), []);
  const [displayMode, setDisplayMode] = useState<TextDisplayMode>('plain');
  const [playbackRate, setPlaybackRate] = useState(1);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [revealedTranslations, setRevealedTranslations] = useState<Set<string>>(
    () => new Set(),
  );
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
    return { book, chapter, rows, audioRows };
  }, [bookId, chapterId]);

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
      {firstPlayable === -1 ? (
        <p className="muted">No native audio for this {chapter ? 'chapter' : 'book'} yet.</p>
      ) : null}
      <div className="stack">
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
                  {revealedTranslations.has(row.sentence.id) ? (
                    <div className="muted">{row.sentence.translation || '(no translation)'}</div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleTranslation(row.sentence.id)}
                    >
                      Show translation
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
