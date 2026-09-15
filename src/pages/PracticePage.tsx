import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';

import { NativeAudioButton } from '../components/NativeAudioButton';
import { ChunkPuzzleStrip } from '../components/ChunkPuzzleStrip';
import { SpeakButton } from '../components/SpeakButton';
import { VocabChips } from '../components/VocabChips';
import {
  getDb,
  getVocabularyTargetCandidates,
  recordGrammarNaturalEncounter,
  recordNaturalEncounter,
  setBookSentenceStatus,
  type VocabularyTargetCandidate,
} from '../db/repository';
import type {
  BookSentence,
  GrammarPattern,
  ReviewRating,
  StudyStatus,
} from '../domain/types';
import { useJapaneseSpeech } from '../hooks/useJapaneseSpeech';
import { useNativeAudio } from '../hooks/useNativeAudio';
import { hashString } from '../lib/ids';
import { summarizeChunks } from '../lib/worksheet';

type PracticeScope = 'all' | 'incomplete' | 'needs_review' | 'unstarted';

const NATURAL_ENCOUNTER_RATINGS: { value: ReviewRating; label: string }[] = [
  { value: 'again', label: 'Again' },
  { value: 'hard', label: 'Hard' },
  { value: 'good', label: 'Good' },
  { value: 'easy', label: 'Easy' },
];

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
    (a, b) => Number.parseInt(hashString(a.sentenceId), 16) - Number.parseInt(hashString(b.sentenceId), 16),
  );
}

export function PracticePage() {
  const { bookId = '', sentenceId: routeSentenceId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = searchParams.get('scope') ?? 'incomplete';
  const shuffled = searchParams.get('shuffle') === '1';
  const [showVocabulary, setShowVocabulary] = useState(true);
  const [reveal, setReveal] = useState({
    chunks: false,
    roles: false,
    lit: false,
    english: false,
  });
  const [attempt, setAttempt] = useState('');
  const [encounteredVocabularyItemIds, setEncounteredVocabularyItemIds] = useState<
    Set<string>
  >(() => new Set());
  const [encounteredGrammarPatternIds, setEncounteredGrammarPatternIds] = useState<
    Set<string>
  >(() => new Set());

  const data = useLiveQuery(async () => {
    const db = getDb();
    const book = await db.books.get(bookId);
    const allMemberships = await db.bookSentences
      .where('bookId')
      .equals(bookId)
      .sortBy('position');
    const scoped = filterMemberships(allMemberships, scope);
    const memberships = sessionOrder(scoped, shuffled);
    const sentenceId =
      routeSentenceId &&
      memberships.some((item) => item.sentenceId === routeSentenceId)
        ? routeSentenceId
        : memberships[0]?.sentenceId;
    if (!sentenceId) {
      return {
        book,
        allMemberships,
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
    const sentenceAudio = await db.sentenceAudio
      .where('sentenceId')
      .equals(sentenceId)
      .toArray();
    // Materialized vocabulary (Phase 5 picker confirms) for this sentence,
    // if any — the natural-encounter panel (Phase 7.8) only offers a quick
    // rating for words the learner has already chosen to track, not every
    // word in the sentence.
    const materializedVocabulary = await getVocabularyTargetCandidates([sentenceId]);
    // Tracked grammar patterns linked to this sentence (Phase 6/7/8 slice of
    // the grammar-learning system) — mirrors the vocabulary natural-encounter
    // panel above, but only surfaces patterns the learner already opted into
    // tracking via GrammarPicker's "Track" button (see
    // recordGrammarNaturalEncounter's doc comment: that policy lives here,
    // not in the repository primitive).
    const sentenceGrammarLinks = await db.sentenceGrammar
      .where('sentenceId')
      .equals(sentenceId)
      .toArray();
    let trackedGrammarPatterns: GrammarPattern[] = [];
    if (sentenceGrammarLinks.length > 0) {
      const patternIds = [...new Set(sentenceGrammarLinks.map((link) => link.grammarPatternId))];
      const [patterns, grammarStudyItems] = await Promise.all([
        db.grammarPatterns.bulkGet(patternIds),
        db.studyItems.where('subjectType').equals('grammarPattern').toArray(),
      ]);
      const trackedPatternIds = new Set(
        grammarStudyItems
          .filter((item) => patternIds.includes(item.subjectId))
          .map((item) => item.subjectId),
      );
      trackedGrammarPatterns = patterns.filter(
        (pattern): pattern is GrammarPattern => !!pattern && trackedPatternIds.has(pattern.id),
      );
    }
    return {
      book,
      allMemberships,
      memberships,
      sentence,
      analysis,
      index,
      membership: memberships[index] ?? null,
      sentenceAudio,
      materializedVocabulary,
      trackedGrammarPatterns,
    };
  }, [bookId, routeSentenceId, scope, shuffled]);

  const summary = useMemo(
    () => summarizeChunks(data?.analysis?.chunks ?? []),
    [data?.analysis?.chunks],
  );

  const { stop: stopSpeech } = useJapaneseSpeech();
  const { stop: stopNativeAudio } = useNativeAudio();

  useEffect(() => {
    setReveal({
      chunks: false,
      roles: false,
      lit: false,
      english: false,
    });
    setAttempt('');
    setEncounteredVocabularyItemIds(new Set());
    setEncounteredGrammarPatternIds(new Set());
  }, [data?.sentence?.id]);

  // Cancel playback when moving between sentences or leaving Practice.
  useEffect(
    () => () => {
      stopSpeech();
      stopNativeAudio();
    },
    [data?.sentence?.id, stopSpeech, stopNativeAudio],
  );

  const query = searchParams.toString();
  const practicePath = (sentenceId: string) =>
    `/books/${bookId}/practice/${sentenceId}${query ? `?${query}` : ''}`;
  const prev =
    data && data.index > 0 ? data.memberships[data.index - 1] : null;
  const next =
    data && data.index >= 0 && data.index < data.memberships.length - 1
      ? data.memberships[data.index + 1]
      : null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.key === 'ArrowLeft' && prev) {
        navigate(practicePath(prev.sentenceId));
      } else if (event.key === 'ArrowRight' && next) {
        navigate(practicePath(next.sentenceId));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!data?.book) return <p className="muted">Loading…</p>;

  const completedInScope = data.memberships.filter(
    (item) => item.status === 'complete',
  ).length;
  const scopeOptions = [
    { value: 'incomplete', label: 'Incomplete' },
    { value: 'needs_review', label: 'Needs review' },
    { value: 'unstarted', label: 'Unstarted' },
    { value: 'all', label: 'All sentences' },
    ...(data.book.chapters ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((chapter) => ({
        value: `chapter:${chapter.id}`,
        label: `Chapter: ${chapter.title}`,
      })),
  ];

  if (!data.sentence) {
    return (
      <div className="empty-state">
        <strong>No sentences match this practice session.</strong>
        <span className="muted">
          Choose another session scope or return to the book.
        </span>
        <select
          value={scope}
          aria-label="Practice scope"
          onChange={(event) => {
            setSearchParams({ scope: event.target.value });
            navigate(`/books/${bookId}/practice?scope=${event.target.value}`);
          }}
        >
          {scopeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Link to={`/books/${bookId}`}>Back to book</Link>
      </div>
    );
  }

  const { book, sentence, memberships, index, membership } = data;
  const matchingSourceId = book.sourceKey?.startsWith('shadowing:')
    ? book.sourceKey.slice('shadowing:'.length)
    : undefined;
  const preferredNativeAudio =
    data.sentenceAudio?.find((audio) => audio.sourceId === matchingSourceId) ??
    data.sentenceAudio?.[0];

  async function mark(status: StudyStatus, advance = false) {
    await setBookSentenceStatus(bookId, sentence.id, status);
    if (advance && next) navigate(practicePath(next.sentenceId));
  }

  async function markEncounter(vocabularyItemId: string, rating: ReviewRating) {
    if (encounteredVocabularyItemIds.has(vocabularyItemId)) return;
    setEncounteredVocabularyItemIds(
      (current) => new Set(current).add(vocabularyItemId),
    );
    await recordNaturalEncounter({
      vocabularyItemId,
      sentenceId: sentence.id,
      rating,
    });
  }

  async function markGrammarEncounter(grammarPatternId: string, rating: ReviewRating) {
    if (encounteredGrammarPatternIds.has(grammarPatternId)) return;
    setEncounteredGrammarPatternIds(
      (current) => new Set(current).add(grammarPatternId),
    );
    await recordGrammarNaturalEncounter({
      grammarPatternId,
      sentenceId: sentence.id,
      rating,
    });
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="muted">{book.title} · Practice</div>
            <strong>
              {index + 1} of {memberships.length}
            </strong>
          </div>
          <div className="row">
            <button
              type="button"
              disabled={!prev}
              onClick={() => prev && navigate(practicePath(prev.sentenceId))}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!next}
              onClick={() => next && navigate(practicePath(next.sentenceId))}
            >
              Next
            </button>
            <Link to={`/books/${bookId}/analyze/${sentence.id}`}>
              <button type="button">Analyze</button>
            </Link>
            <Link to={`/books/${bookId}/shadow/${sentence.id}`}>
              <button type="button">Shadow</button>
            </Link>
          </div>
        </div>

        <div className="practice-session-controls">
          <label>
            Session
            <select
              value={scope}
              aria-label="Practice scope"
              onChange={(event) => {
                const nextScope = event.target.value;
                const params = new URLSearchParams(searchParams);
                params.set('scope', nextScope);
                setSearchParams(params);
                navigate(`/books/${bookId}/practice?${params.toString()}`);
              }}
            >
              {scopeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="selection-control">
            <input
              type="checkbox"
              checked={shuffled}
              onChange={(event) => {
                const params = new URLSearchParams(searchParams);
                if (event.target.checked) params.set('shuffle', '1');
                else params.delete('shuffle');
                setSearchParams(params);
                navigate(`/books/${bookId}/practice?${params.toString()}`);
              }}
            />
            Shuffle session
          </label>
          <label className="selection-control">
            <input
              type="checkbox"
              checked={showVocabulary}
              onChange={(event) => setShowVocabulary(event.target.checked)}
            />
            Show target vocabulary
          </label>
        </div>
        <div className="muted">
          Session progress: {completedInScope}/{memberships.length} complete
        </div>
        <div className="progress-bar" aria-hidden="true">
          <span
            style={{
              width: `${
                memberships.length
                  ? Math.round((completedInScope / memberships.length) * 100)
                  : 0
              }%`,
            }}
          />
        </div>

        <div className="row" style={{ alignItems: 'center' }}>
          <div className="jp jp-lg" style={{ flex: 1 }}>
            {sentence.japanese}
          </div>
          {preferredNativeAudio ? (
            <NativeAudioButton audio={preferredNativeAudio} />
          ) : null}
          <SpeakButton
            text={sentence.japanese}
            itemId={`practice-${sentence.id}`}
            label="Play Japanese sentence with device TTS"
            displayLabel="TTS"
          />
        </div>
        {showVocabulary ? (
          <VocabChips items={sentence.targetVocabulary} />
        ) : null}
        {showVocabulary && data.materializedVocabulary.length > 0 ? (
          <div className="stack" style={{ gap: '0.35rem' }}>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              Recognized these without hints?
            </div>
            {data.materializedVocabulary.map((candidate) => (
              <NaturalEncounterRow
                key={candidate.vocabularyItem.id}
                candidate={candidate}
                recorded={encounteredVocabularyItemIds.has(candidate.vocabularyItem.id)}
                onRate={(rating) => void markEncounter(candidate.vocabularyItem.id, rating)}
              />
            ))}
          </div>
        ) : null}
        {data.trackedGrammarPatterns.length > 0 ? (
          <div className="stack" style={{ gap: '0.35rem' }}>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              Recognized this grammar without hints?
            </div>
            {data.trackedGrammarPatterns.map((pattern) => (
              <div key={pattern.id} className="row" style={{ alignItems: 'center' }}>
                <span className="jp">{pattern.canonicalName}</span>
                {pattern.shortMeaning ? (
                  <span className="muted">{pattern.shortMeaning}</span>
                ) : null}
                {encounteredGrammarPatternIds.has(pattern.id) ? (
                  <span className="muted">Recorded</span>
                ) : (
                  NATURAL_ENCOUNTER_RATINGS.map((rating) => (
                    <button
                      key={rating.value}
                      type="button"
                      onClick={() => void markGrammarEncounter(pattern.id, rating.value)}
                    >
                      {rating.label}
                    </button>
                  ))
                )}
              </div>
            ))}
          </div>
        ) : null}
        <label>
          Temporary attempt (not saved unless you copy into Analyze)
          <textarea
            value={attempt}
            onChange={(event) => setAttempt(event.target.value)}
            placeholder="Optional scratch notes…"
          />
        </label>
        <div className="row">
          <button
            type="button"
            onClick={() => setReveal((value) => ({ ...value, chunks: true }))}
          >
            Reveal chunks
          </button>
          <button
            type="button"
            onClick={() => setReveal((value) => ({ ...value, roles: true }))}
          >
            Reveal roles
          </button>
          <button
            type="button"
            onClick={() => setReveal((value) => ({ ...value, lit: true }))}
          >
            Reveal literal English
          </button>
          <button
            type="button"
            onClick={() => setReveal((value) => ({ ...value, english: true }))}
          >
            Reveal Satori English
          </button>
          <button
            type="button"
            onClick={() =>
              setReveal({
                chunks: true,
                roles: true,
                lit: true,
                english: true,
              })
            }
          >
            Reveal all
          </button>
          <button
            type="button"
            onClick={() =>
              setReveal({
                chunks: false,
                roles: false,
                lit: false,
                english: false,
              })
            }
          >
            Hide all
          </button>
        </div>
        {reveal.chunks && data.analysis?.chunks?.length ? (
          <ChunkPuzzleStrip
            chunks={data.analysis.chunks}
            revealRoles={reveal.roles}
          />
        ) : null}
        <div className="summary-lines">
          {reveal.chunks ? `CHUNK: ${summary.chunk}` : 'CHUNK: (hidden)'}
          {'\n'}
          {reveal.roles ? `ROLE: ${summary.role}` : 'ROLE: (hidden)'}
          {'\n'}
          {reveal.lit ? `LIT: ${summary.lit}` : 'LIT: (hidden)'}
          {'\n'}
          {reveal.english
            ? `EN: ${sentence.translation || '(none)'}`
            : 'EN: (hidden)'}
        </div>
        <div className="row">
          <span className={`status-pill ${membership?.status ?? 'unstarted'}`}>
            {membership?.status ?? 'unstarted'}
          </span>
          <button type="button" onClick={() => void mark('unstarted')}>
            Unstarted
          </button>
          <button type="button" onClick={() => void mark('in_progress')}>
            In progress
          </button>
          <button type="button" onClick={() => void mark('complete')}>
            Complete
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void mark('complete', true)}
          >
            Complete & next
          </button>
          <button type="button" onClick={() => void mark('needs_review')}>
            Needs review
          </button>
          <button type="button" onClick={() => void mark('needs_review', true)}>
            Needs review & next
          </button>
        </div>
        <div className="muted" style={{ fontSize: '0.85rem' }}>
          Desktop shortcut: use ← and → to move through the session.
        </div>
      </section>
    </div>
  );
}

/**
 * One materialized vocabulary item's natural-encounter quick-rate row
 * (Phase 7.8, docs brief §9/§16): unlike ReviewPage's cards, there's
 * nothing to hide — the learner has already read the full sentence with
 * translation available — so this is a bare self-report, not a test. Rating
 * disables the row (one rating per sentence visit; revisiting the word in a
 * later sentence is a separate, legitimate encounter).
 */
function NaturalEncounterRow({
  candidate,
  recorded,
  onRate,
}: {
  candidate: VocabularyTargetCandidate;
  recorded: boolean;
  onRate: (rating: ReviewRating) => void;
}) {
  const { vocabularyItem, surfaceForm } = candidate;
  return (
    <div className="row" style={{ alignItems: 'center' }}>
      <span className="jp">{surfaceForm || vocabularyItem.expression}</span>
      {vocabularyItem.reading ? (
        <span className="muted">({vocabularyItem.reading})</span>
      ) : null}
      {vocabularyItem.meaning ? (
        <span className="muted">{vocabularyItem.meaning}</span>
      ) : null}
      {recorded ? (
        <span className="muted">Recorded</span>
      ) : (
        NATURAL_ENCOUNTER_RATINGS.map((rating) => (
          <button
            key={rating.value}
            type="button"
            onClick={() => onRate(rating.value)}
          >
            {rating.label}
          </button>
        ))
      )}
    </div>
  );
}
