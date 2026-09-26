import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { getKeystoneCandidates, logGameRound } from '../../db/repository';
import type { GameRoundItem, GameSignal } from '../../domain/types';
import {
  buildKeystoneRound,
  describeKeystonePick,
  KEYSTONE_GAME_ID,
  KEYSTONE_ROUND_SIZE,
  type KeystoneCandidate,
  type KeystonePuzzle,
} from '../../lib/keystone';
import { GameShell, type GamePhase } from './GameShell';

export { KEYSTONE_GAME_ID };

interface Settled extends GameRoundItem {
  puzzle: KeystonePuzzle;
  chosenId: string;
}

function PuzzleCard({
  puzzle,
  chosenId,
  onChoose,
}: {
  puzzle: KeystonePuzzle;
  /** Set once a choice has been made — the puzzle's reveal. */
  chosenId: string | null;
  onChoose: (id: string) => void;
}) {
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        Which of these words shows up in the most sentences you haven&apos;t read yet?
      </p>
      <div className="stack" style={{ gap: '0.4rem' }}>
        {puzzle.choices.map((choice) => {
          const isAnswer = choice.id === puzzle.answerVocabularyItemId;
          const isChosen = choice.id === chosenId;
          return (
            <button
              key={choice.id}
              type="button"
              className="ghost"
              disabled={!!chosenId}
              onClick={() => onChoose(choice.id)}
              style={{
                textAlign: 'left',
                borderStyle: chosenId && (isAnswer || isChosen) ? 'solid' : undefined,
                borderWidth: chosenId && (isAnswer || isChosen) ? 2 : undefined,
                borderColor: chosenId
                  ? isAnswer
                    ? 'var(--success)'
                    : isChosen
                      ? 'var(--danger)'
                      : undefined
                  : undefined,
              }}
            >
              <span className="jp jp-lg">{choice.item.expression}</span>{' '}
              <span className="muted">
                {choice.item.reading} — {choice.item.meaning}
              </span>
              {chosenId ? (
                <span
                  style={{
                    float: 'right',
                    color: isAnswer ? 'var(--success)' : isChosen ? 'var(--danger)' : undefined,
                  }}
                >
                  {isAnswer ? '✓ ' : isChosen ? '✗ ' : ''}
                  {choice.unlockedSentenceIds.length}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {chosenId ? (
        <div className="stack" style={{ gap: '0.3rem' }} role="status">
          <div>
            <strong>{chosenId === puzzle.answerVocabularyItemId ? '✓ Correct' : '✗ Not quite'}</strong>
          </div>
          {puzzle.choices.map((choice) => (
            <div key={choice.id} className="muted" style={{ fontSize: '0.85rem' }}>
              <span className="jp">{choice.item.expression}</span> — {describeKeystonePick(choice)}
              <div className="jp">{choice.exampleSentence.japanese}</div>
              {choice.exampleSentence.translation ? (
                <div>{choice.exampleSentence.translation}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Keystone (docs/ROADMAP.md "Short games"): a front door to the no-card backlog — see src/lib/keystone.ts. */
export function KeystoneGame({ signal: _signal }: { signal: GameSignal }) {
  const [candidates, setCandidates] = useState<KeystoneCandidate[] | null>(null);
  const [round, setRound] = useState<{ puzzles: KeystonePuzzle[]; poolSize: number } | null>(null);
  const [phase, setPhase] = useState<GamePhase>('intro');
  const [index, setIndex] = useState(0);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [results, setResults] = useState<Settled[]>([]);
  const shownAt = useRef(Date.now());
  const logged = useRef(false);
  const started = useRef(false);

  // Loaded once per visit (not live) so a Dexie refresh can't reshuffle mid-round.
  useEffect(() => {
    let cancelled = false;
    void getKeystoneCandidates().then((loaded) => {
      if (!cancelled) setCandidates(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const newRound = useCallback((from: KeystoneCandidate[]) => {
    const seed = `${Date.now()}:${Math.random()}`;
    setRound(buildKeystoneRound(from, KEYSTONE_ROUND_SIZE, seed));
    setPhase('intro');
    setIndex(0);
    setChosenId(null);
    setResults([]);
    logged.current = false;
  }, []);

  useEffect(() => {
    if (candidates && !started.current) {
      started.current = true;
      newRound(candidates);
    }
  }, [candidates, newRound]);

  if (!candidates || !round) return <p className="muted">Loading…</p>;

  if (round.puzzles.length < KEYSTONE_ROUND_SIZE) {
    return (
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Keystone</h2>
        <p className="muted" style={{ margin: 0 }}>
          Needs at least {KEYSTONE_ROUND_SIZE} confirmed words with no study card yet that appear
          in your books&apos; next unread sentences — you have {candidates.length} so far.
        </p>
        <Link to="/play">Back to games</Link>
      </section>
    );
  }

  const { puzzles, poolSize } = round;
  const puzzle = puzzles[index]!;
  const total = puzzles.length;
  const correctCount = results.filter((r) => r.correct).length;

  function handleChoose(id: string) {
    if (chosenId) return;
    setChosenId(id);
    const correct = id === puzzle.answerVocabularyItemId;
    setResults((prev) => [
      ...prev,
      {
        ref: puzzle.answerVocabularyItemId,
        correct,
        cluesUsed: 0,
        wrongGuesses: correct ? 0 : 1,
        points: correct ? 1 : 0,
        ms: Date.now() - shownAt.current,
        puzzle,
        chosenId: id,
      },
    ]);
  }

  function next() {
    if (index + 1 < total) {
      setIndex(index + 1);
      setChosenId(null);
      shownAt.current = Date.now();
      return;
    }
    if (!logged.current) {
      logged.current = true;
      void logGameRound({
        gameId: KEYSTONE_GAME_ID,
        signal: 'any',
        poolSize,
        items: results.map(({ puzzle: _puzzle, chosenId: _chosenId, ...item }) => item),
      });
    }
    setPhase('result');
  }

  return (
    <GameShell
      title="Keystone"
      phase={phase}
      progress={{ current: index + (chosenId ? 1 : 0), total }}
      intro={{
        signalLabel: 'No-card backlog',
        whyLine: `${poolSize} confirmed word${poolSize === 1 ? '' : 's'} with no study card yet, appearing in your books' next unread sentences.`,
        roundDescription: `${total} rounds — for each, guess which word unlocks the most upcoming reading, about 2 minutes.`,
        onStart: () => {
          shownAt.current = Date.now();
          setPhase('play');
        },
      }}
    >
      {phase === 'play' ? (
        <>
          <PuzzleCard key={puzzle.answerVocabularyItemId} puzzle={puzzle} chosenId={chosenId} onChoose={handleChoose} />
          {chosenId ? (
            <div>
              <button type="button" className="primary" onClick={next}>
                {index + 1 < total ? 'Next' : 'See results'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {phase === 'result' ? (
        <div className="stack">
          <div>
            <strong>
              {correctCount} / {total} correct
            </strong>
          </div>
          {results.map((r, i) => {
            const answer = r.puzzle.choices.find(
              (c) => c.id === r.puzzle.answerVocabularyItemId,
            )!;
            const chosen = r.puzzle.choices.find((c) => c.id === r.chosenId)!;
            return (
              <div key={i} className="stack" style={{ gap: '0.15rem' }}>
                <div className="jp">
                  {r.correct ? '✓ ' : '✗ '}
                  {answer.item.expression}
                </div>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  {describeKeystonePick(answer)}
                  {r.correct ? null : ` You picked ${chosen.item.expression} instead.`}
                </div>
              </div>
            );
          })}
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
