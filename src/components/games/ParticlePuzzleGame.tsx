import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  getParticlePuzzleData,
  getPrecedingSentences,
  getRecentGameDifficulty,
  logGameRound,
  type ParticlePuzzleCandidate,
} from '../../db/repository';
import type { GameRoundItem, GameSignal, Sentence } from '../../domain/types';
import {
  describeRound,
  pickItems,
  SIGNAL_LABELS,
  type DifficultyTier,
  type PickResult,
} from '../../lib/gamePicker';
import {
  buildParticlePuzzle,
  describeParticlePick,
  PARTICLE_PUZZLE_GAME_ID,
  PARTICLE_PUZZLE_ROUND_SIZE,
  puzzlePointsAvailable,
  scorePuzzle,
  type ParticlePuzzle,
} from '../../lib/particlePuzzle';
import { GameShell, type GamePhase } from './GameShell';

export { PARTICLE_PUZZLE_GAME_ID };

type Score = ReturnType<typeof scorePuzzle>;
type ParticlePuzzleData = Awaited<ReturnType<typeof getParticlePuzzleData>>;

interface Entry {
  candidate: ParticlePuzzleCandidate;
  puzzle: ParticlePuzzle;
  context: Sentence[];
}

interface Settled extends GameRoundItem {
  entry: Entry;
  score: Score;
  why: string;
}

function filledSentence(puzzle: ParticlePuzzle): string {
  return puzzle.segments
    .map((segment) => (segment.kind === 'text' ? segment.text : puzzle.answers[segment.blank]!))
    .join('');
}

function PuzzleCard({
  entry,
  done,
  onComplete,
}: {
  entry: Entry;
  /** Set once every blank is locked in — the sentence's final score. */
  done: Score | null;
  onComplete: (wrongTries: string[][]) => void;
}) {
  const { puzzle, context, candidate } = entry;
  const blankCount = puzzle.answers.length;
  // chip id locked into each blank once judged correct (null = still open)
  const [locked, setLocked] = useState<(string | null)[]>(() => puzzle.answers.map(() => null));
  // what was tried and rejected in each blank, in order
  const [wrongTries, setWrongTries] = useState<string[][]>(() => puzzle.answers.map(() => []));
  const [selected, setSelected] = useState<string | null>(null);
  // the most recent wrong placement, shown red until the next tap
  const [flash, setFlash] = useState<{ blank: number; text: string } | null>(null);
  const chipText = (id: string | null) => puzzle.bank.find((chip) => chip.id === id)?.text ?? '';
  const lockedIds = new Set(locked.filter((id): id is string => id !== null));
  const wrongCount = wrongTries.reduce((sum, tries) => sum + tries.length, 0);

  function tapChip(id: string) {
    if (done || lockedIds.has(id)) return;
    setFlash(null);
    setSelected((current) => (current === id ? null : id));
  }

  // Each placement is judged immediately: right locks green, wrong flashes red,
  // returns to the bank, and costs a point.
  function tapBlank(blank: number) {
    if (done || locked[blank] || !selected) return;
    const text = chipText(selected);
    if (text === puzzle.answers[blank]) {
      const nextLocked = locked.map((id, i) => (i === blank ? selected : id));
      setLocked(nextLocked);
      setFlash(null);
      setSelected(null);
      if (nextLocked.every((id) => id !== null)) onComplete(wrongTries);
    } else {
      setWrongTries((prev) => prev.map((tries, i) => (i === blank ? [...tries, text] : tries)));
      setFlash({ blank, text });
      setSelected(null);
    }
  }

  return (
    <div className="stack">
      {context.length > 0 ? (
        <div className="stack" style={{ gap: '0.2rem' }}>
          {context.map((sentence) => (
            <div key={sentence.id} className="jp muted">
              {sentence.japanese}
            </div>
          ))}
        </div>
      ) : null}

      <div className="jp jp-lg" style={{ lineHeight: 2.2 }}>
        {puzzle.segments.map((segment, index) => {
          if (segment.kind === 'text') return <span key={index}>{segment.text}</span>;
          const lockedId = locked[segment.blank] ?? null;
          const flashed = flash?.blank === segment.blank ? flash : null;
          const label = lockedId
            ? `Blank ${segment.blank + 1}: ${chipText(lockedId)}, correct`
            : flashed
              ? `Blank ${segment.blank + 1}: tried ${flashed.text}, incorrect`
              : `Blank ${segment.blank + 1}, empty`;
          return (
            <button
              key={index}
              type="button"
              className="ghost"
              onClick={() => tapBlank(segment.blank)}
              aria-label={label}
              style={{
                minWidth: '2.6rem',
                margin: '0 0.15rem',
                padding: '0.1rem 0.4rem',
                fontSize: 'inherit',
                borderStyle: lockedId || flashed ? 'solid' : 'dashed',
                borderWidth: lockedId || flashed ? 2 : undefined,
                borderColor: lockedId
                  ? 'var(--success)'
                  : flashed
                    ? 'var(--danger)'
                    : selected
                      ? 'var(--accent)'
                      : undefined,
                color: lockedId ? 'var(--success)' : flashed ? 'var(--danger)' : undefined,
              }}
            >
              {lockedId ? `${chipText(lockedId)} ✓` : flashed ? `${flashed.text} ✗` : '＿'}
            </button>
          );
        })}
      </div>

      {!done ? (
        <>
          <div className="row" aria-label="Particle bank">
            {puzzle.bank.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className={selected === chip.id ? 'primary' : 'ghost'}
                aria-pressed={selected === chip.id}
                disabled={lockedIds.has(chip.id)}
                onClick={() => tapChip(chip.id)}
                style={{ minWidth: '2.6rem', fontSize: '1.15rem' }}
              >
                {chip.text}
              </button>
            ))}
          </div>
          <div className="row" role="status">
            <strong>Worth {puzzlePointsAvailable(blankCount, wrongCount)} now</strong>
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {flash
                ? `✗ Not ${flash.text} there — that cost a point.`
                : 'Tap a particle, then the blank it belongs in. Each wrong pick costs a point.'}
            </span>
          </div>
        </>
      ) : (
        <div className="stack" style={{ gap: '0.3rem' }} role="status">
          <div>
            <strong>
              {done.allCorrect ? '✓ Clean — ' : ''}
              {done.points} / {done.maxPoints} points
            </strong>
          </div>
          {done.blanks
            .filter((blank) => !blank.correct)
            .map((blank, index) => (
              <div key={index}>
                ✗ For <span className="jp">{blank.expected}</span> you tried{' '}
                <span className="jp">{blank.wrongTries.join('・')}</span> first.
                {blank.plausibleAlternative ? (
                  <span className="muted">
                    {' '}
                    は / が / も swaps are often both natural; check the earlier lines for what is
                    already known.
                  </span>
                ) : null}
              </div>
            ))}
          <div className="muted">{candidate.sentence.translation}</div>
        </div>
      )}
    </div>
  );
}

interface Round {
  pick: PickResult<ParticlePuzzleCandidate>;
  entries: Entry[];
}

const PARTICLE_COPY = {
  anyPool: 'your confirmed sentences',
  blurbs: {
    weak: "Sentences with particles you've mixed up before.",
    stale: 'Sentences whose particles need another look.',
    strong: 'Sentences whose particles you reliably get right — a relaxed round.',
  },
};
export { PARTICLE_COPY };

export function ParticlePuzzleGame({ signal }: { signal: GameSignal }) {
  const [data, setData] = useState<ParticlePuzzleData | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [phase, setPhase] = useState<GamePhase>('intro');
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState<Score | null>(null);
  const [results, setResults] = useState<Settled[]>([]);
  const shownAt = useRef(Date.now());
  const logged = useRef(false);
  const started = useRef(false);
  const [difficulty, setDifficulty] = useState<DifficultyTier>('standard');

  // Loaded once per visit (not live) so a Dexie refresh can't reshuffle mid-round.
  useEffect(() => {
    let cancelled = false;
    void getParticlePuzzleData().then((loaded) => {
      if (!cancelled) setData(loaded);
    });
    void getRecentGameDifficulty(PARTICLE_PUZZLE_GAME_ID).then((tier) => {
      if (!cancelled) setDifficulty(tier);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const newRound = useCallback(
    async (from: ParticlePuzzleData) => {
      const seed = `${Date.now()}:${Math.random()}`;
      const pick = pickItems(from.candidates, {
        signal,
        n: PARTICLE_PUZZLE_ROUND_SIZE,
        seed,
        difficulty,
      });
      const built = pick.items.flatMap((candidate) => {
        const puzzle = buildParticlePuzzle(candidate.sentence, {
          seed: `${seed}:${candidate.id}`,
          focus: from.focus,
        });
        return puzzle ? [{ candidate, puzzle }] : [];
      });
      const context = await getPrecedingSentences(built.map((b) => b.candidate.id));
      setRound({
        pick,
        entries: built.map((b) => ({ ...b, context: context.get(b.candidate.id) ?? [] })),
      });
      setPhase('intro');
      setIndex(0);
      setScore(null);
      setResults([]);
      logged.current = false;
    },
    [signal, difficulty],
  );

  useEffect(() => {
    if (data && !started.current) {
      started.current = true;
      void newRound(data);
    }
  }, [data, newRound]);

  if (!data || !round) return <p className="muted">Loading…</p>;

  const { pick, entries } = round;
  if (entries.length < PARTICLE_PUZZLE_ROUND_SIZE) {
    return (
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Particle Puzzle</h2>
        <p className="muted" style={{ margin: 0 }}>
          Needs at least {PARTICLE_PUZZLE_ROUND_SIZE} sentences whose vocabulary you&apos;ve
          confirmed and that have two or more particles to fill — you have{' '}
          {data.candidates.length} so far.
        </p>
        <Link to="/play">Back to games</Link>
      </section>
    );
  }

  const focus = data.focus;
  const entry = entries[index]!;
  const total = entries.length;
  const maxPoints = entries.reduce((sum, e) => sum + e.puzzle.answers.length, 0);
  const totalPoints = results.reduce((sum, r) => sum + r.points, 0);

  function handleComplete(wrongTries: string[][]) {
    const scored = scorePuzzle(entry.puzzle, wrongTries);
    setScore(scored);
    setResults((prev) => [
      ...prev,
      {
        ref: entry.candidate.id,
        correct: scored.allCorrect,
        cluesUsed: 0,
        wrongGuesses: scored.wrongCount,
        points: scored.points,
        ms: Date.now() - shownAt.current,
        parts: scored.blanks.map((blank) => ({
          key: blank.expected,
          correct: blank.correct,
          ...(blank.correct ? {} : { note: blank.wrongTries[0] }),
        })),
        entry,
        score: scored,
        why: describeParticlePick(pick.signal, entry.candidate.particles, focus),
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
        gameId: PARTICLE_PUZZLE_GAME_ID,
        signal: pick.signal,
        poolSize: pick.poolSize,
        items: results.map(({ entry: _entry, score: _score, why: _why, ...item }) => item),
      });
    }
    setPhase('result');
  }

  return (
    <GameShell
      title="Particle Puzzle"
      phase={phase}
      progress={{ current: index + (score ? 1 : 0), total }}
      intro={{
        signalLabel: pick.signal === 'any' ? 'Your sentences' : SIGNAL_LABELS[pick.signal],
        whyLine: describeRound(pick, PARTICLE_COPY),
        roundDescription: `${total} real sentences from your books with their particles removed, about 2 minutes. Each sentence starts worth one point per blank and loses one for every wrong pick. The translation stays hidden until it's done.`,
        onStart: () => {
          shownAt.current = Date.now();
          setPhase('play');
        },
      }}
    >
      {phase === 'play' ? (
        <>
          <PuzzleCard key={entry.candidate.id} entry={entry} done={score} onComplete={handleComplete} />
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
              — {results.filter((r) => r.correct).length} of {total} sentences with no wrong picks
            </span>
          </div>
          {results.map((r) => (
            <div key={r.ref} className="stack" style={{ gap: '0.25rem' }}>
              <div className="jp jp-lg">
                {r.correct ? '✓ ' : ''}
                {filledSentence(r.entry.puzzle)}{' '}
                <span className="muted" style={{ fontSize: '0.85rem' }}>
                  {r.points} / {r.score.maxPoints}
                </span>
              </div>
              <div className="muted">{r.entry.candidate.sentence.translation}</div>
              {r.score.blanks
                .filter((blank) => !blank.correct)
                .map((blank, i) => (
                  <div key={i} className="muted" style={{ fontSize: '0.85rem' }}>
                    For {blank.expected} you tried {blank.wrongTries.join('・')} first.
                  </div>
                ))}
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                Why this sentence: {r.why}
              </div>
            </div>
          ))}
          <div className="row">
            <button type="button" className="primary" onClick={() => void newRound(data)}>
              Play again
            </button>
            <Link to="/play">All games</Link>
          </div>
        </div>
      ) : null}
    </GameShell>
  );
}
