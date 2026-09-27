import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  getGrammarDetectiveCandidates,
  getRecentGameDifficulty,
  logGameRound,
  type GrammarDetectiveCandidate,
} from '../../db/repository';
import type { GameRoundItem, GameSignal } from '../../domain/types';
import {
  describeRound,
  pickItems,
  SIGNAL_LABELS,
  type DifficultyTier,
  type PickResult,
} from '../../lib/gamePicker';
import {
  buildGrammarClueLadder,
  describeGrammarPick,
  GRAMMAR_CLUE_LABELS,
  GRAMMAR_DETECTIVE_COPY,
  GRAMMAR_DETECTIVE_ROUND_SIZE,
  grammarFirstKana,
  isGrammarDetectiveAnswerCorrect,
  MAX_GRAMMAR_POINTS,
  scoreGrammarWord,
  type GrammarDetectiveWord,
} from '../../lib/grammarDetective';
import { blankPatternInSentence } from '../../lib/grammarPatterns';
import { NativeAudioButton } from '../NativeAudioButton';
import { GameShell, type GamePhase } from './GameShell';

export const GRAMMAR_DETECTIVE_GAME_ID = 'grammar-detective';

interface PatternResult extends GameRoundItem {
  word: GrammarDetectiveWord;
  why: string;
}

function BlankedSentence({ word, revealed }: { word: GrammarDetectiveWord; revealed?: boolean }) {
  const blank = blankPatternInSentence(word.japanese, word.canonicalName);
  if (!blank) return <div className="jp jp-lg">{word.japanese}</div>;
  return (
    <div className="jp jp-lg">
      {blank.before}
      <mark>{revealed ? blank.match : '_____'}</mark>
      {blank.after}
    </div>
  );
}

function PatternCard({
  word,
  onSettled,
}: {
  word: GrammarDetectiveWord;
  onSettled: (outcome: { solved: boolean; cluesUsed: number; wrongGuesses: number; ms: number }) => void;
}) {
  const ladder = useMemo(() => buildGrammarClueLadder(word), [word]);
  const [guess, setGuess] = useState('');
  const [cluesShown, setCluesShown] = useState(0);
  const [wrongGuesses, setWrongGuesses] = useState(0);
  const [status, setStatus] = useState<'asking' | 'solved' | 'gaveup'>('asking');
  const [lastWrong, setLastWrong] = useState(false);
  const startedAt = useRef(Date.now());

  const shown = ladder.slice(0, cluesShown);
  const { before, after, bookTitle } = word.readingContext;
  const settled = status !== 'asking';

  function settle(solved: boolean, wrong: number) {
    setStatus(solved ? 'solved' : 'gaveup');
    onSettled({ solved, cluesUsed: cluesShown, wrongGuesses: wrong, ms: Date.now() - startedAt.current });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (settled || !guess.trim()) return;
    if (isGrammarDetectiveAnswerCorrect(word, guess)) {
      setLastWrong(false);
      settle(true, wrongGuesses);
    } else {
      setWrongGuesses((count) => count + 1);
      setLastWrong(true);
    }
  }

  return (
    <div className="stack">
      <BlankedSentence word={word} revealed={settled} />

      {shown.map((clue) => (
        <div key={clue} className="stack" style={{ gap: '0.3rem' }}>
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            {GRAMMAR_CLUE_LABELS[clue]}
          </span>
          {clue === 'translation' ? <div>{word.translation}</div> : null}
          {clue === 'context' ? (
            <div className="reading-context">
              {bookTitle ? (
                <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                  In context · {bookTitle}
                </p>
              ) : null}
              {before.map((sentence) => (
                <p key={sentence.id} className="jp jp-sm reading-context-line">
                  {sentence.japanese}
                </p>
              ))}
              {after.map((sentence) => (
                <p key={sentence.id} className="jp jp-sm reading-context-line">
                  {sentence.japanese}
                </p>
              ))}
            </div>
          ) : null}
          {clue === 'meaning' ? <div>{word.shortMeaning}</div> : null}
          {clue === 'first_kana' ? <div className="jp jp-lg">{grammarFirstKana(word)}…</div> : null}
          {clue === 'audio' && word.audio ? (
            <div>
              <NativeAudioButton audio={word.audio} displayLabel="Hear the sentence" />
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
            placeholder="The grammar construction"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="The grammar construction"
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
              : `Clue: ${GRAMMAR_CLUE_LABELS[ladder[cluesShown]!]}`}
          </button>
          <button type="button" className="ghost" onClick={() => settle(false, wrongGuesses)}>
            Give up
          </button>
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            Worth {Math.max(1, MAX_GRAMMAR_POINTS - cluesShown - wrongGuesses)} now
          </span>
        </div>
      ) : (
        <div className="stack" style={{ gap: '0.3rem' }} role="status">
          <div>
            {status === 'solved' ? '✓ ' : ''}
            <span className="jp jp-lg">{word.canonicalName}</span>
          </div>
          {word.shortMeaning ? <div className="muted">{word.shortMeaning}</div> : null}
          <div className="muted">{word.translation}</div>
        </div>
      )}
    </div>
  );
}

interface Round {
  pick: PickResult<GrammarDetectiveCandidate>;
}

export function GrammarDetectiveGame({ signal }: { signal: GameSignal }) {
  const [candidates, setCandidates] = useState<GrammarDetectiveCandidate[] | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [phase, setPhase] = useState<GamePhase>('intro');
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<PatternResult[]>([]);
  const [wordSettled, setWordSettled] = useState(false);
  const [difficulty, setDifficulty] = useState<DifficultyTier>('standard');
  const logged = useRef(false);

  // Loaded once per visit (not live) so a Dexie refresh can't reshuffle mid-round.
  useEffect(() => {
    let cancelled = false;
    void getGrammarDetectiveCandidates().then((rows) => {
      if (!cancelled) setCandidates(rows);
    });
    void getRecentGameDifficulty(GRAMMAR_DETECTIVE_GAME_ID).then((tier) => {
      if (!cancelled) setDifficulty(tier);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const newRound = useCallback(
    (from: GrammarDetectiveCandidate[]) => {
      setRound({
        pick: pickItems(from, {
          signal,
          n: GRAMMAR_DETECTIVE_ROUND_SIZE,
          seed: `${Date.now()}:${Math.random()}`,
          difficulty,
        }),
      });
      setPhase('intro');
      setIndex(0);
      setResults([]);
      setWordSettled(false);
      logged.current = false;
    },
    [signal, difficulty],
  );

  useEffect(() => {
    if (candidates && !round) newRound(candidates);
  }, [candidates, round, newRound]);

  if (!candidates || !round) return <p className="muted">Loading…</p>;

  const { pick } = round;
  if (pick.items.length < GRAMMAR_DETECTIVE_ROUND_SIZE) {
    return (
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Grammar Detective</h2>
        <p className="muted" style={{ margin: 0 }}>
          Needs at least {GRAMMAR_DETECTIVE_ROUND_SIZE} tracked grammar patterns with a translated
          sentence — you have {candidates.length} so far. Tracking a pattern's "Got it" from a
          sentence while you read will grow this.
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
        points: scoreGrammarWord(outcome),
        ms: outcome.ms,
        word: current.word,
        why: describeGrammarPick(pick.signal, current.stats),
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
        gameId: GRAMMAR_DETECTIVE_GAME_ID,
        signal: pick.signal,
        poolSize: pick.poolSize,
        items: results.map(({ word: _word, why: _why, ...item }) => item),
      });
    }
    setPhase('result');
  }

  return (
    <GameShell
      title="Grammar Detective"
      phase={phase}
      progress={{ current: index + (wordSettled ? 1 : 0), total }}
      intro={{
        signalLabel: pick.signal === 'any' ? 'Your tracked patterns' : SIGNAL_LABELS[pick.signal],
        whyLine: describeRound(pick, GRAMMAR_DETECTIVE_COPY),
        roundDescription: `${total} mystery grammar patterns from sentences you've tracked, about 90 seconds. Type the construction; every clue you take costs a point.`,
        onStart: () => setPhase('play'),
      }}
    >
      {phase === 'play' ? (
        <>
          <PatternCard key={current.id} word={current.word} onSettled={handleSettled} />
          {wordSettled ? (
            <div>
              <button type="button" className="primary" onClick={next}>
                {index + 1 < total ? 'Next pattern' : 'See results'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {phase === 'result' ? (
        <div className="stack">
          <div>
            <strong>
              {totalPoints} / {total * MAX_GRAMMAR_POINTS} points
            </strong>{' '}
            <span className="muted">
              — {results.filter((r) => r.correct).length} of {total} solved
            </span>
          </div>
          {results.map((r) => (
            <div key={r.ref} className="stack" style={{ gap: '0.25rem' }}>
              <div>
                {r.correct ? '✓' : '✗'} <span className="jp jp-lg">{r.word.canonicalName}</span>{' '}
                <span className="muted">
                  · {r.points} pt{r.points === 1 ? '' : 's'} · {r.cluesUsed} clue
                  {r.cluesUsed === 1 ? '' : 's'}
                </span>
              </div>
              {r.word.shortMeaning ? <div className="muted">{r.word.shortMeaning}</div> : null}
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                Why this pattern: {r.why}
              </div>
              {r.word.audio ? (
                <div>
                  <NativeAudioButton audio={r.word.audio} displayLabel="Replay" />
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
