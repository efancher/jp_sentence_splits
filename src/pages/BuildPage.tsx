import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';

import { ChunkPuzzleStrip } from '../components/ChunkPuzzleStrip';
import { SpeakButton } from '../components/SpeakButton';
import { VocabChips } from '../components/VocabChips';
import { getDb, setBookSentenceStatus } from '../db/repository';
import type { AnalysisChunk, BookSentence, StudyStatus } from '../domain/types';
import {
  BUILD_HINT_LABELS,
  BUILD_HINT_MAX,
  buildTileFace,
  checkBuildAssembly,
  clampBuildHintLevel,
  correctChunkIds,
  nextBuildHintLevel,
  shuffleChunkIds,
  type BuildHintLevel,
} from '../lib/buildMode';
import { hashString } from '../lib/ids';
import { puzzleShapeClassName, puzzleShapeFamily } from '../lib/puzzleShapes';

type PracticeScope = 'all' | 'incomplete' | 'needs_review' | 'unstarted';

function filterMemberships(
  memberships: BookSentence[],
  scope: string,
): BookSentence[] {
  if (scope.startsWith('chapter:')) {
    const chapterId = scope.slice('chapter:'.length);
    return memberships.filter((item) => item.chapterId === chapterId);
  }
  switch (scope as PracticeScope) {
    case 'needs_review':
      return memberships.filter((item) => item.status === 'needs_review');
    case 'unstarted':
      return memberships.filter((item) => item.status === 'unstarted');
    case 'incomplete':
      return memberships.filter((item) => item.status !== 'complete');
    case 'all':
    default:
      return memberships;
  }
}

function sessionOrder(
  memberships: BookSentence[],
  shuffled: boolean,
): BookSentence[] {
  if (!shuffled) return memberships;
  return [...memberships].sort(
    (a, b) =>
      Number.parseInt(hashString(a.sentenceId), 16) -
      Number.parseInt(hashString(b.sentenceId), 16),
  );
}

function chunkMap(chunks: AnalysisChunk[]): Map<string, AnalysisChunk> {
  return new Map(chunks.map((chunk) => [chunk.id, chunk]));
}

export function BuildPage() {
  const { bookId = '', sentenceId: routeSentenceId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = searchParams.get('scope') ?? 'incomplete';
  const shuffled = searchParams.get('shuffle') === '1';

  const [hintLevel, setHintLevel] = useState<BuildHintLevel>(0);
  const [bankSeed, setBankSeed] = useState(0);
  const [assembled, setAssembled] = useState<string[]>([]);
  const [checkResult, setCheckResult] = useState<ReturnType<
    typeof checkBuildAssembly
  > | null>(null);
  const [revealedAnswer, setRevealedAnswer] = useState(false);

  const data = useLiveQuery(async () => {
    const db = getDb();
    const book = await db.books.get(bookId);
    const allMemberships = await db.bookSentences
      .where('bookId')
      .equals(bookId)
      .sortBy('position');
    const scoped = filterMemberships(allMemberships, scope);
    const withChunks: BookSentence[] = [];
    for (const membership of scoped) {
      const analysis = await db.analyses.get(membership.sentenceId);
      if (analysis?.chunks?.length) withChunks.push(membership);
    }
    const memberships = sessionOrder(withChunks, shuffled);
    const sentenceId =
      routeSentenceId &&
      memberships.some((item) => item.sentenceId === routeSentenceId)
        ? routeSentenceId
        : memberships[0]?.sentenceId;
    if (!sentenceId) {
      return {
        book,
        memberships,
        sentence: null,
        analysis: null,
        index: -1,
        membership: null,
      };
    }
    const index = memberships.findIndex(
      (item) => item.sentenceId === sentenceId,
    );
    const [sentence, analysis] = await Promise.all([
      db.sentences.get(sentenceId),
      db.analyses.get(sentenceId),
    ]);
    return {
      book,
      memberships,
      sentence,
      analysis,
      index,
      membership: memberships[index] ?? null,
    };
  }, [bookId, routeSentenceId, scope, shuffled]);

  const chunks = data?.analysis?.chunks ?? [];
  const correctIds = useMemo(() => correctChunkIds(chunks), [chunks]);
  const byId = useMemo(() => chunkMap(chunks), [chunks]);

  const bankIds = useMemo(() => {
    if (!chunks.length || !data?.sentence) return [];
    return shuffleChunkIds(
      correctIds,
      `${data.sentence.id}:${bankSeed}`,
    ).filter((id) => !assembled.includes(id));
  }, [chunks, correctIds, data?.sentence, bankSeed, assembled]);

  useEffect(() => {
    setAssembled([]);
    setCheckResult(null);
    setRevealedAnswer(false);
    setHintLevel(0);
    setBankSeed(0);
  }, [data?.sentence?.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (!data?.memberships?.length || data.index < 0) return;
      const prev = data.memberships[data.index - 1];
      const next = data.memberships[data.index + 1];
      const query = searchParams.toString();
      const path = (sentenceId: string) =>
        `/books/${bookId}/build/${sentenceId}${query ? `?${query}` : ''}`;
      if (event.key === 'ArrowLeft' && prev) navigate(path(prev.sentenceId));
      if (event.key === 'ArrowRight' && next) navigate(path(next.sentenceId));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bookId, data, navigate, searchParams]);

  if (!data) return <div className="route-loading">Loading…</div>;
  if (!data.book) {
    return (
      <div className="stack">
        <strong>Book not found.</strong>
        <Link to="/">Back to books</Link>
      </div>
    );
  }

  const buildPath = (sentenceId: string) => {
    const query = searchParams.toString();
    return `/books/${bookId}/build/${sentenceId}${query ? `?${query}` : ''}`;
  };

  if (!data.memberships.length || !data.sentence || !data.analysis) {
    return (
      <div className="stack panel">
        <strong>No buildable sentences in this session.</strong>
        <p className="muted" style={{ margin: 0 }}>
          Build needs analyzed sentences with chunks. Open Analyze first, or
          widen the session scope.
        </p>
        <div className="row">
          <select
            value={scope}
            aria-label="Build scope"
            onChange={(event) => {
              setSearchParams({ scope: event.target.value });
              navigate(`/books/${bookId}/build?scope=${event.target.value}`);
            }}
          >
            <option value="incomplete">Incomplete</option>
            <option value="needs_review">Needs review</option>
            <option value="unstarted">Unstarted</option>
            <option value="all">All</option>
          </select>
          <Link to={`/books/${bookId}`}>Back to book</Link>
          <Link to={`/books/${bookId}/practice`}>Practice instead</Link>
        </div>
      </div>
    );
  }

  const { book, sentence, memberships, index, membership } = data;
  const prev = memberships[index - 1];
  const next = memberships[index + 1];
  const englishPrompt =
    sentence.translation?.trim() ||
    '(No Satori English — use sticky-English hints.)';

  async function mark(status: StudyStatus, advance = false) {
    await setBookSentenceStatus(bookId, sentence.id, status);
    if (advance && next) navigate(buildPath(next.sentenceId));
  }

  function addToAssembly(chunkId: string) {
    setAssembled((current) => [...current, chunkId]);
    setCheckResult(null);
    setRevealedAnswer(false);
  }

  function removeFromAssembly(atIndex: number) {
    setAssembled((current) => current.filter((_, i) => i !== atIndex));
    setCheckResult(null);
    setRevealedAnswer(false);
  }

  function runCheck() {
    setCheckResult(checkBuildAssembly(assembled, correctIds));
  }

  function renderTile(
    chunk: AnalysisChunk,
    options: {
      onClick: () => void;
      placed?: boolean;
      slotIndex?: number;
    },
  ) {
    const face = buildTileFace(chunk, hintLevel);
    const family = puzzleShapeFamily(chunk.role);
    return (
      <button
        type="button"
        className={[
          'build-tile',
          puzzleShapeClassName(family),
          face.showShape ? 'build-tile-shaped' : '',
          options.placed ? 'build-tile-placed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={options.onClick}
        title={chunk.role || 'chunk'}
      >
        {typeof options.slotIndex === 'number' ? (
          <span className="build-tile-index muted">{options.slotIndex + 1}</span>
        ) : null}
        <span className={`build-tile-primary${hintLevel >= 5 ? ' jp' : ''}`}>
          {face.primary}
        </span>
        {face.secondary ? (
          <span className="build-tile-secondary muted">{face.secondary}</span>
        ) : null}
      </button>
    );
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="muted">{book.title} · Build</div>
            <strong>
              {index + 1} of {memberships.length}
            </strong>
          </div>
          <div className="row">
            <button
              type="button"
              disabled={!prev}
              onClick={() => prev && navigate(buildPath(prev.sentenceId))}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!next}
              onClick={() => next && navigate(buildPath(next.sentenceId))}
            >
              Next
            </button>
          </div>
        </div>

        <div className="practice-session-controls">
          <label>
            Session
            <select
              value={scope}
              aria-label="Build scope"
              onChange={(event) => {
                const params = new URLSearchParams(searchParams);
                params.set('scope', event.target.value);
                setSearchParams(params);
                navigate(`/books/${bookId}/build?${params.toString()}`);
              }}
            >
              <option value="incomplete">Incomplete</option>
              <option value="needs_review">Needs review</option>
              <option value="unstarted">Unstarted</option>
              <option value="all">All</option>
              {(book.chapters ?? []).map((chapter) => (
                <option key={chapter.id} value={`chapter:${chapter.id}`}>
                  Chapter: {chapter.title}
                </option>
              ))}
            </select>
          </label>
          <label className="row" style={{ alignItems: 'center', gap: '0.4rem' }}>
            <input
              type="checkbox"
              checked={shuffled}
              onChange={(event) => {
                const params = new URLSearchParams(searchParams);
                if (event.target.checked) params.set('shuffle', '1');
                else params.delete('shuffle');
                setSearchParams(params);
                navigate(`/books/${bookId}/build?${params.toString()}`);
              }}
            />
            Shuffle session
          </label>
        </div>

        <div className="build-prompt stack">
          <div className="muted">English prompt</div>
          <p className="build-prompt-text">{englishPrompt}</p>
          {sentence.japanese && hintLevel >= 5 ? (
            <div className="jp muted" style={{ fontSize: '0.95rem' }}>
              (Answer JP available at this hint level — assemble from tiles
              below.)
            </div>
          ) : null}
        </div>

        {hintLevel >= 1 ? (
          <VocabChips items={sentence.targetVocabulary} />
        ) : null}

        <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted">
            Hint: {BUILD_HINT_LABELS[hintLevel]} ({hintLevel}/{BUILD_HINT_MAX})
          </span>
          <button
            type="button"
            disabled={hintLevel >= BUILD_HINT_MAX}
            onClick={() => setHintLevel((level) => nextBuildHintLevel(level))}
          >
            More hint
          </button>
          <button
            type="button"
            disabled={hintLevel <= 0}
            onClick={() =>
              setHintLevel((level) => clampBuildHintLevel(level - 1))
            }
          >
            Less hint
          </button>
        </div>

        {hintLevel >= 2 ? (
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            Target length: {correctIds.length} piece
            {correctIds.length === 1 ? '' : 's'}
          </div>
        ) : null}

        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>Your assembly</strong>
            <button
              type="button"
              onClick={() => {
                setAssembled([]);
                setCheckResult(null);
                setRevealedAnswer(false);
              }}
            >
              Clear
            </button>
          </div>
          <div className="build-assembly" aria-label="Assembled chunks">
            {assembled.length ? (
              assembled.map((id, slotIndex) => {
                const chunk = byId.get(id);
                if (!chunk) return null;
                return (
                  <div key={`${id}-${slotIndex}`}>
                    {renderTile(chunk, {
                      placed: true,
                      slotIndex,
                      onClick: () => removeFromAssembly(slotIndex),
                    })}
                  </div>
                );
              })
            ) : (
              <div className="muted">Tap tiles from the bank to build…</div>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>Tile bank</strong>
            <button
              type="button"
              onClick={() => {
                setBankSeed((value) => value + 1);
                setAssembled([]);
                setCheckResult(null);
                setRevealedAnswer(false);
              }}
            >
              Reshuffle bank
            </button>
          </div>
          <div className="build-bank" aria-label="Chunk tile bank">
            {bankIds.length ? (
              bankIds.map((id) => {
                const chunk = byId.get(id);
                if (!chunk) return null;
                return (
                  <div key={id}>
                    {renderTile(chunk, { onClick: () => addToAssembly(id) })}
                  </div>
                );
              })
            ) : (
              <div className="muted">Bank empty — all tiles placed.</div>
            )}
          </div>
        </div>

        <div className="row">
          <button type="button" className="primary" onClick={runCheck}>
            Check
          </button>
          <button
            type="button"
            onClick={() => {
              setRevealedAnswer(true);
              setHintLevel(BUILD_HINT_MAX as BuildHintLevel);
            }}
          >
            Reveal answer
          </button>
          <SpeakButton
            text={sentence.japanese}
            itemId={`build-${sentence.id}`}
            label="Play Japanese sentence with device TTS"
            displayLabel="TTS"
          />
          <Link to={`/books/${bookId}/analyze/${sentence.id}`}>Analyze</Link>
          <Link to={`/books/${bookId}/practice/${sentence.id}`}>Practice</Link>
        </div>

        {checkResult ? (
          <div
            className={`build-check ${checkResult.perfect ? 'ok' : 'warn'}`}
            role="status"
          >
            {checkResult.perfect
              ? 'Perfect — chunk order matches your analysis.'
              : `Not yet. First ${checkResult.matchedPrefix} of ${correctIds.length} in the right place${checkResult.lengthMatch ? '' : ` (you placed ${assembled.length})`}.`}
          </div>
        ) : null}

        {revealedAnswer || checkResult?.perfect ? (
          <ChunkPuzzleStrip chunks={chunks} revealRoles showLegend={false} />
        ) : null}

        <div className="row">
          <span className={`status-pill ${membership?.status ?? 'unstarted'}`}>
            {membership?.status ?? 'unstarted'}
          </span>
          <button type="button" onClick={() => void mark('in_progress')}>
            In progress
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void mark('complete', true)}
          >
            Complete & next
          </button>
          <button type="button" onClick={() => void mark('needs_review', true)}>
            Needs review & next
          </button>
        </div>
      </section>
    </div>
  );
}
