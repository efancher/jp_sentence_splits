import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { getEarTilesCandidates, logGameRound, type EarTilesCandidate } from '../../db/repository';
import type { GameRoundItem, GameSignal } from '../../domain/types';
import {
  buildEarTilesPuzzle,
  describeEarTilesPick,
  EAR_TILES_COPY,
  EAR_TILES_GAME_ID,
  EAR_TILES_ROUND_SIZE,
  earTilesPointsAvailable,
  isCorrectTile,
  scoreEarTiles,
  type EarTilesPuzzle,
  type EarTilesScore,
} from '../../lib/earTiles';
import { describeRound, pickItems, SIGNAL_LABELS, type PickResult } from '../../lib/gamePicker';
import { NativeAudioButton } from '../NativeAudioButton';
import { GameShell, type GamePhase } from './GameShell';

export { EAR_TILES_COPY, EAR_TILES_GAME_ID };

interface Entry {
  candidate: EarTilesCandidate;
  puzzle: EarTilesPuzzle;
}

interface Settled extends GameRoundItem {
  entry: Entry;
  score: EarTilesScore;
  why: string;
}

interface Round {
  pick: PickResult<EarTilesCandidate>;
  entries: Entry[];
}

function TilesCard({
  entry,
  done,
  onComplete,
}: {
  entry: Entry;
  /** Set once every tile is placed — the sentence's final score. */
  done: EarTilesScore | null;
  onComplete: (wrongTries: string[][], translationShown: boolean) => void;
}) {
  const { puzzle, candidate } = entry;
  const total = puzzle.answer.length;
  // tile ids placed so far, in slot order (each was judged correct when tapped)
  const [placed, setPlaced] = useState<string[]>([]);
  // what was tried and rejected at each slot, in order
  const [wrongTries, setWrongTries] = useState<string[][]>(() => puzzle.answer.map(() => []));
  // the most recent wrong tap, shown red until the next tap
  const [flash, setFlash] = useState<{ id: string; text: string } | null>(null);
  const [translationShown, setTranslationShown] = useState(false);
  const textOf = (id: string) => puzzle.bank.find((tile) => tile.id === id)?.text ?? '';
  const wrongCount = wrongTries.reduce((sum, tries) => sum + tries.length, 0);

  // Each tap is judged against the next slot at once: right locks green, wrong
  // flashes red, stays in the bank, and costs a point.
  function tapTile(id: string) {
    if (done || placed.includes(id)) return;
    const slot = placed.length;
    const text = textOf(id);
    if (isCorrectTile(puzzle, slot, text)) {
      const nextPlaced = [...placed, id];
      setPlaced(nextPlaced);
      setFlash(null);
      if (nextPlaced.length === total) onComplete(wrongTries, translationShown);
    } else {
      setWrongTries((prev) => prev.map((tries, i) => (i === slot ? [...tries, text] : tries)));
      setFlash({ id, text });
    }
  }

  function showTranslation() {
    setTranslationShown(true);
  }

  return (
    <div className="stack">
      <div className="row" style={{ alignItems: 'center' }}>
        <NativeAudioButton audio={candidate.audio} displayLabel="Hear the sentence" />
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          Tap the tiles in the order you hear them. Replay as often as you like.
        </span>
      </div>

      <div
        className="row jp jp-lg"
        style={{ minHeight: '3rem', gap: '0.35rem', flexWrap: 'wrap' }}
        aria-label="Sentence so far"
      >
        {puzzle.answer.map((_, slot) => {
          const id = placed[slot];
          return id ? (
            <span
              key={slot}
              style={{
                padding: '0.1rem 0.5rem',
                border: '2px solid var(--success)',
                borderRadius: 'var(--radius)',
                color: 'var(--success)',
              }}
            >
              {textOf(id)}
            </span>
          ) : (
            <span
              key={slot}
              aria-label={`Slot ${slot + 1}, empty`}
              style={{
                minWidth: '2rem',
                padding: '0.1rem 0.5rem',
                border: `2px dashed ${slot === placed.length && !done ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)',
                textAlign: 'center',
              }}
            >
              ＿
            </span>
          );
        })}
      </div>

      {!done ? (
        <>
          <div className="row" style={{ flexWrap: 'wrap' }} aria-label="Tile bank">
            {puzzle.bank.map((tile) => {
              const isPlaced = placed.includes(tile.id);
              const flashed = flash?.id === tile.id;
              return (
                <button
                  key={tile.id}
                  type="button"
                  className="ghost"
                  disabled={isPlaced}
                  onClick={() => tapTile(tile.id)}
                  aria-label={flashed ? `${tile.text}, incorrect` : tile.text}
                  style={{
                    fontSize: '1.15rem',
                    opacity: isPlaced ? 0.3 : 1,
                    borderStyle: 'solid',
                    borderWidth: 2,
                    borderColor: flashed ? 'var(--danger)' : undefined,
                    color: flashed ? 'var(--danger)' : undefined,
                  }}
                >
                  <span className="jp">{tile.text}</span>
                </button>
              );
            })}
          </div>
          <div className="row" role="status">
            <strong>
              Worth {earTilesPointsAvailable(total, wrongCount, translationShown)} now
            </strong>
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {flash
                ? `✗ Not ${flash.text} next — that cost a point.`
                : 'Each wrong tile costs a point.'}
            </span>
          </div>
          {translationShown ? (
            <div className="muted">{candidate.sentence.translation}</div>
          ) : (
            <div>
              <button type="button" className="ghost" onClick={showTranslation}>
                Peek at the translation (−1)
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="stack" style={{ gap: '0.3rem' }} role="status">
          <div>
            <strong>
              {done.clean ? '✓ Clean — ' : ''}
              {done.points} / {done.maxPoints} points
            </strong>
          </div>
          {done.wrongTries.flatMap((tries, slot) =>
            tries.length > 0 ? (
              <div key={slot}>
                ✗ For <span className="jp">{puzzle.answer[slot]}</span> you tried{' '}
                <span className="jp">{tries.join('・')}</span> first.
              </div>
            ) : (
              []
            ),
          )}
          <div className="muted">{candidate.sentence.translation}</div>
        </div>
      )}
    </div>
  );
}

export function EarTilesGame({ signal }: { signal: GameSignal }) {
  const [candidates, setCandidates] = useState<EarTilesCandidate[] | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [phase, setPhase] = useState<GamePhase>('intro');
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState<EarTilesScore | null>(null);
  const [results, setResults] = useState<Settled[]>([]);
  const shownAt = useRef(Date.now());
  const logged = useRef(false);
  const started = useRef(false);

  // Loaded once per visit (not live) so a Dexie refresh can't reshuffle mid-round.
  useEffect(() => {
    let cancelled = false;
    void getEarTilesCandidates().then((loaded) => {
      if (!cancelled) setCandidates(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const newRound = useCallback(
    (from: EarTilesCandidate[]) => {
      const seed = `${Date.now()}:${Math.random()}`;
      const pick = pickItems(from, { signal, n: EAR_TILES_ROUND_SIZE, seed });
      const entries = pick.items.flatMap((candidate) => {
        const puzzle = buildEarTilesPuzzle(candidate.sentence, { seed: `${seed}:${candidate.id}` });
        return puzzle ? [{ candidate, puzzle }] : [];
      });
      setRound({ pick, entries });
      setPhase('intro');
      setIndex(0);
      setScore(null);
      setResults([]);
      logged.current = false;
    },
    [signal],
  );

  useEffect(() => {
    if (candidates && !started.current) {
      started.current = true;
      newRound(candidates);
    }
  }, [candidates, newRound]);

  if (!candidates || !round) return <p className="muted">Loading…</p>;

  const { pick, entries } = round;
  if (entries.length < EAR_TILES_ROUND_SIZE) {
    return (
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Ear Tiles</h2>
        <p className="muted" style={{ margin: 0 }}>
          Needs at least {EAR_TILES_ROUND_SIZE} sentences with native audio whose vocabulary you&apos;ve
          confirmed and that split into 4–7 phrases — you have {candidates.length} so far.
        </p>
        <Link to="/play">Back to games</Link>
      </section>
    );
  }

  const entry = entries[index]!;
  const total = entries.length;
  const maxPoints = entries.reduce((sum, e) => sum + e.puzzle.answer.length, 0);
  const totalPoints = results.reduce((sum, r) => sum + r.points, 0);

  function handleComplete(wrongTries: string[][], translationShown: boolean) {
    const scored = scoreEarTiles(entry.puzzle, wrongTries, translationShown);
    setScore(scored);
    setResults((prev) => [
      ...prev,
      {
        ref: entry.candidate.id,
        correct: scored.clean,
        cluesUsed: translationShown ? 1 : 0,
        wrongGuesses: scored.wrongCount,
        points: scored.points,
        ms: Date.now() - shownAt.current,
        parts: entry.puzzle.answer.map((text, slot) => ({
          key: text,
          correct: scored.wrongTries[slot]!.length === 0,
          ...(scored.wrongTries[slot]!.length > 0 ? { note: scored.wrongTries[slot]![0] } : {}),
        })),
        entry,
        score: scored,
        why: describeEarTilesPick(pick.signal, entry.candidate.weakWords),
      },
    ]);
  }

  function next() {
    if (index + 1 < total) {
      setIndex(index + 1);
      setScore(null);
      shownAt.current = Date.now();
      return;
    }
    if (!logged.current) {
      logged.current = true;
      void logGameRound({
        gameId: EAR_TILES_GAME_ID,
        signal: pick.signal,
        poolSize: pick.poolSize,
        items: results.map(({ entry: _entry, score: _score, why: _why, ...item }) => item),
      });
    }
    setPhase('result');
  }

  return (
    <GameShell
      title="Ear Tiles"
      phase={phase}
      progress={{ current: index + (score ? 1 : 0), total }}
      intro={{
        signalLabel: pick.signal === 'any' ? 'Your sentences' : SIGNAL_LABELS[pick.signal],
        whyLine: describeRound(pick, EAR_TILES_COPY),
        roundDescription: `${total} real sentences with native audio, about 3 minutes. Hear one, then tap its phrase tiles in the order you heard them — the audio decides, even where another order would be grammatical. Each sentence starts worth one point per tile and loses one for every wrong tile or translation peek.`,
        onStart: () => {
          shownAt.current = Date.now();
          setPhase('play');
        },
      }}
    >
      {phase === 'play' ? (
        <>
          <TilesCard key={entry.candidate.id} entry={entry} done={score} onComplete={handleComplete} />
          {score ? (
            <div>
              <button type="button" className="primary" onClick={next}>
                {index + 1 < total ? 'Next sentence' : 'See results'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {phase === 'result' ? (
        <div className="stack">
          <div>
            <strong>
              {totalPoints} / {maxPoints} points
            </strong>{' '}
            <span className="muted">
              — {results.filter((r) => r.correct).length} of {total} sentences with no wrong tiles or peeks
            </span>
          </div>
          {results.map((r) => (
            <div key={r.ref} className="stack" style={{ gap: '0.25rem' }}>
              <div className="jp jp-lg">
                {r.correct ? '✓ ' : ''}
                {r.entry.puzzle.answer.join(' ')}{' '}
                <span className="muted" style={{ fontSize: '0.85rem' }}>
                  {r.points} / {r.score.maxPoints}
                </span>
              </div>
              <div className="muted">{r.entry.candidate.sentence.translation}</div>
              {r.score.wrongTries.flatMap((tries, slot) =>
                tries.length > 0
                  ? [
                      <div key={slot} className="muted" style={{ fontSize: '0.85rem' }}>
                        For {r.entry.puzzle.answer[slot]} you tried {tries.join('・')} first.
                      </div>,
                    ]
                  : [],
              )}
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                Why this sentence: {r.why}
              </div>
              <div>
                <NativeAudioButton audio={r.entry.candidate.audio} displayLabel="Replay" />
              </div>
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
