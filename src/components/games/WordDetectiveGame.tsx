import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { getWordDetectiveCandidates, logGameRound, type WordDetectiveCandidate } from '../../db/repository';
import type { GameRoundItem, GameSignal } from '../../domain/types';
import {
  describePick,
  describeRound,
  pickItems,
  SIGNAL_LABELS,
  type PickResult,
} from '../../lib/gamePicker';
import {
  blankedParts,
  buildClueLadder,
  CLUE_LABELS,
  firstKana,
  isWordDetectiveAnswerCorrect,
  MAX_WORD_POINTS,
  scoreWord,
  WORD_DETECTIVE_ROUND_SIZE,
  type WordDetectiveOccurrence,
  type WordDetectiveWord,
} from '../../lib/wordDetective';
import { NativeAudioButton } from '../NativeAudioButton';
import { GameShell, type GamePhase } from './GameShell';

export const WORD_DETECTIVE_GAME_ID = 'word-detective';

interface WordResult extends GameRoundItem {
  word: WordDetectiveWord;
  why: string;
}

function BlankedSentence({ occurrence, revealed }: { occurrence: WordDetectiveOccurrence; revealed?: boolean }) {
  const parts = blankedParts(occurrence);
  return (
    <div className="jp jp-lg">
      {parts ? parts.before : occurrence.japanese}
      {parts ? <mark>{revealed ? occurrence.surfaceForm : '_____'}</mark> : null}
      {parts ? parts.after : null}
    </div>
  );
}

function WordCard({
  word,
  onSettled,
}: {
  word: WordDetectiveWord;
  onSettled: (outcome: { solved: boolean; cluesUsed: number; wrongGuesses: number; ms: number }) => void;
}) {
  const ladder = useMemo(() => buildClueLadder(word), [word]);
  const [guess, setGuess] = useState('');
  const [cluesShown, setCluesShown] = useState(0);
  const [wrongGuesses, setWrongGuesses] = useState(0);
  const [status, setStatus] = useState<'asking' | 'solved' | 'gaveup'>('asking');
  const [lastWrong, setLastWrong] = useState(false);
  const startedAt = useRef(Date.now());

  const shown = ladder.slice(0, cluesShown);
  const primary = word.occurrences[0]!;
  const second = word.occurrences[1]!;
  const settled = status !== 'asking';

  function settle(solved: boolean, wrong: number) {
    setStatus(solved ? 'solved' : 'gaveup');
    onSettled({ solved, cluesUsed: cluesShown, wrongGuesses: wrong, ms: Date.now() - startedAt.current });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (settled || !guess.trim()) return;
    if (isWordDetectiveAnswerCorrect(word, guess)) {
      setLastWrong(false);
      settle(true, wrongGuesses);
    } else {
      setWrongGuesses((count) => count + 1);
      setLastWrong(true);
    }
  }

  return (
    <div className="stack">
      <BlankedSentence occurrence={primary} revealed={settled} />

      {shown.map((clue) => (
        <div key={clue} className="stack" style={{ gap: '0.3rem' }}>
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            {CLUE_LABELS[clue]}
          </span>
          {clue === 'translation' ? <div>{primary.translation}</div> : null}
          {clue === 'second_sentence' ? (
            <>
              <BlankedSentence occurrence={second} revealed={settled} />
              {second.translation ? <div className="muted">{second.translation}</div> : null}
            </>
          ) : null}
          {clue === 'meaning' ? <div>{word.meaning}</div> : null}
          {clue === 'first_kana' ? <div className="jp jp-lg">{firstKana(word)}…</div> : null}
          {clue === 'audio' && primary.audio ? (
            <div>
              <NativeAudioButton audio={primary.audio} displayLabel="Hear the sentence" />
            </div>
          ) : null}
        </div>
      ))}

      {!settled ? (
        <form className="row" onSubmit={submit}>
          <input
            type="text"
            lang="ja"
            value={guess}
            onChange={(event) => setGuess(event.target.value)}
            placeholder="Reading of the missing word"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Reading of the missing word"
            style={{ flex: '1 1 12rem' }}
          />
          <button type="submit" className="primary" disabled={!guess.trim()}>
            Guess
          </button>
        </form>
      ) : null}
      {!settled && lastWrong ? (
        <div className="muted" role="status">
          Not quite — try again, or take a clue.
        </div>
      ) : null}
      {!settled ? (
        <div className="row">
          <button
            type="button"
            className="ghost"
            disabled={cluesShown >= ladder.length}
            onClick={() => setCluesShown((count) => count + 1)}
          >
            {cluesShown >= ladder.length
              ? 'No more clues'
              : `Clue: ${CLUE_LABELS[ladder[cluesShown]!]}`}
          </button>
          <button type="button" className="ghost" onClick={() => settle(false, wrongGuesses)}>
            Give up
          </button>
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            Worth {Math.max(1, MAX_WORD_POINTS - cluesShown - wrongGuesses)} now
          </span>
        </div>
      ) : (
        <div className="stack" style={{ gap: '0.3rem' }} role="status">
          <div>
            {status === 'solved' ? '✓ ' : ''}
            <span className="jp jp-lg">{word.expression}</span>{' '}
            <span className="jp">{word.reading}</span>
          </div>
          {word.meaning ? <div className="muted">{word.meaning}</div> : null}
          <div className="muted">{primary.translation}</div>
        </div>
      )}
    </div>
  );
}

interface Round {
  pick: PickResult<WordDetectiveCandidate>;
}

export function WordDetectiveGame({ signal }: { signal: GameSignal }) {
  const [candidates, setCandidates] = useState<WordDetectiveCandidate[] | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [phase, setPhase] = useState<GamePhase>('intro');
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<WordResult[]>([]);
  const [wordSettled, setWordSettled] = useState(false);
  const logged = useRef(false);

  // Loaded once per visit (not live) so a Dexie refresh can't reshuffle mid-round.
  useEffect(() => {
    let cancelled = false;
    void getWordDetectiveCandidates().then((rows) => {
      if (!cancelled) setCandidates(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const newRound = useCallback(
    (from: WordDetectiveCandidate[]) => {
      setRound({
        pick: pickItems(from, {
          signal,
          n: WORD_DETECTIVE_ROUND_SIZE,
          seed: `${Date.now()}:${Math.random()}`,
        }),
      });
      setPhase('intro');
      setIndex(0);
      setResults([]);
      setWordSettled(false);
      logged.current = false;
    },
    [signal],
  );

  useEffect(() => {
    if (candidates && !round) newRound(candidates);
  }, [candidates, round, newRound]);

  if (!candidates || !round) return <p className="muted">Loading…</p>;

  const { pick } = round;
  if (pick.items.length < WORD_DETECTIVE_ROUND_SIZE) {
    return (
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Word Detective</h2>
        <p className="muted" style={{ margin: 0 }}>
          Needs at least {WORD_DETECTIVE_ROUND_SIZE} confirmed words that you&apos;ve met in two
          different sentences — you have {candidates.length} so far. Confirming vocabulary while
          you work through books will grow this.
        </p>
        <Link to="/play">Back to games</Link>
      </section>
    );
  }

  const current = pick.items[index]!;
  const total = pick.items.length;
  const totalPoints = results.reduce((sum, r) => sum + r.points, 0);

  function handleSettled(outcome: { solved: boolean; cluesUsed: number; wrongGuesses: number; ms: number }) {
    setWordSettled(true);
    setResults((prev) => [
      ...prev,
      {
        ref: current.id,
        correct: outcome.solved,
        cluesUsed: outcome.cluesUsed,
        wrongGuesses: outcome.wrongGuesses,
        points: scoreWord(outcome),
        ms: outcome.ms,
        word: current.word,
        why: describePick(pick.signal, current.stats),
      },
    ]);
  }

  function next() {
    if (index + 1 < total) {
      setIndex(index + 1);
      setWordSettled(false);
      return;
    }
    if (!logged.current) {
      logged.current = true;
      void logGameRound({
        gameId: WORD_DETECTIVE_GAME_ID,
        signal: pick.signal,
        poolSize: pick.poolSize,
        items: results.map(({ word: _word, why: _why, ...item }) => item),
      });
    }
    setPhase('result');
  }

  return (
    <GameShell
      title="Word Detective"
      phase={phase}
      progress={{ current: index + (wordSettled ? 1 : 0), total }}
      intro={{
        signalLabel: pick.signal === 'any' ? 'Your vocabulary' : SIGNAL_LABELS[pick.signal],
        whyLine: describeRound(pick),
        roundDescription: `${total} mystery words from your own books, about 90 seconds. Type the reading; every clue you take costs a point.`,
        onStart: () => setPhase('play'),
      }}
    >
      {phase === 'play' ? (
        <>
          <WordCard key={current.id} word={current.word} onSettled={handleSettled} />
          {wordSettled ? (
            <div>
              <button type="button" className="primary" onClick={next}>
                {index + 1 < total ? 'Next word' : 'See results'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {phase === 'result' ? (
        <div className="stack">
          <div>
            <strong>
              {totalPoints} / {total * MAX_WORD_POINTS} points
            </strong>{' '}
            <span className="muted">
              — {results.filter((r) => r.correct).length} of {total} solved
            </span>
          </div>
          {results.map((r) => (
            <div key={r.ref} className="stack" style={{ gap: '0.25rem' }}>
              <div>
                {r.correct ? '✓' : '✗'} <span className="jp jp-lg">{r.word.expression}</span>{' '}
                <span className="jp">{r.word.reading}</span>{' '}
                <span className="muted">
                  · {r.points} pt{r.points === 1 ? '' : 's'} · {r.cluesUsed} clue
                  {r.cluesUsed === 1 ? '' : 's'}
                </span>
              </div>
              {r.word.meaning ? <div className="muted">{r.word.meaning}</div> : null}
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                Why this word: {r.why}
              </div>
              {r.word.occurrences[0]!.audio ? (
                <div>
                  <NativeAudioButton audio={r.word.occurrences[0]!.audio} displayLabel="Replay" />
                </div>
              ) : null}
            </div>
          ))}
          <div className="row">
            <button type="button" className="primary" onClick={() => newRound(candidates)}>
              Play again
            </button>
            <Link to="/play">All games</Link>
          </div>
        </div>
      ) : null}
    </GameShell>
  );
}
