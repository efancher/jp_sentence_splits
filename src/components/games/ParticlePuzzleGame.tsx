import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  getParticlePuzzleData,
  getPrecedingSentences,
  logGameRound,
  type ParticlePuzzleCandidate,
} from '../../db/repository';
import type { GameRoundItem, GameSignal, Sentence } from '../../domain/types';
import { describeRound, pickItems, SIGNAL_LABELS, type PickResult } from '../../lib/gamePicker';
import {
  buildParticlePuzzle,
  describeParticlePick,
  gradePuzzle,
  PARTICLE_PUZZLE_GAME_ID,
  PARTICLE_PUZZLE_ROUND_SIZE,
  type ParticlePuzzle,
} from '../../lib/particlePuzzle';
import { GameShell, type GamePhase } from './GameShell';

export { PARTICLE_PUZZLE_GAME_ID };

type Grade = ReturnType<typeof gradePuzzle>;
type ParticlePuzzleData = Awaited<ReturnType<typeof getParticlePuzzleData>>;

interface Entry {
  candidate: ParticlePuzzleCandidate;
  puzzle: ParticlePuzzle;
  context: Sentence[];
}

interface Settled extends GameRoundItem {
  entry: Entry;
  grade: Grade;
  why: string;
}

function filledSentence(puzzle: ParticlePuzzle): string {
  return puzzle.segments
    .map((segment) => (segment.kind === 'text' ? segment.text : puzzle.answers[segment.blank]!))
    .join('');
}

function PuzzleCard({
  entry,
  checked,
  onCheck,
}: {
  entry: Entry;
  checked: Grade | null;
  onCheck: (placements: string[]) => void;
}) {
  const { puzzle, context, candidate } = entry;
  // chip id placed in each blank (null = empty)
  const [placements, setPlacements] = useState<(string | null)[]>(() =>
    puzzle.answers.map(() => null),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const chipText = (id: string | null) => puzzle.bank.find((chip) => chip.id === id)?.text ?? '';
  const placedIds = new Set(placements.filter((id): id is string => id !== null));
  const allFilled = placements.every((id) => id !== null);

  function tapBlank(blank: number) {
    if (checked) return;
    if (selected) {
      setPlacements((prev) => prev.map((id, i) => (i === blank ? selected : id)));
      setSelected(null);
    } else if (placements[blank]) {
      // Tap a filled blank with nothing selected: send its chip back to the bank.
      setPlacements((prev) => prev.map((id, i) => (i === blank ? null : id)));
    }
  }

  function tapChip(id: string) {
    if (checked || placedIds.has(id)) return;
    setSelected((current) => (current === id ? null : id));
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
          const id = placements[segment.blank] ?? null;
          const result = checked?.blanks[segment.blank];
          return (
            <button
              key={index}
              type="button"
              className="ghost"
              onClick={() => tapBlank(segment.blank)}
              aria-label={
                id
                  ? `Blank ${segment.blank + 1}: ${chipText(id)}${
                      result ? (result.correct ? ', correct' : ', incorrect') : ''
                    }`
                  : `Blank ${segment.blank + 1}, empty`
              }
              style={{
                minWidth: '2.6rem',
                margin: '0 0.15rem',
                padding: '0.1rem 0.4rem',
                fontSize: 'inherit',
                borderStyle: id ? 'solid' : 'dashed',
                borderColor: result
                  ? result.correct
                    ? 'var(--success)'
                    : 'var(--danger)'
                  : selected
                    ? 'var(--accent)'
                    : undefined,
              }}
            >
              {id ? chipText(id) : '＿'}
              {result ? (result.correct ? ' ✓' : ' ✗') : ''}
            </button>
          );
        })}
      </div>

      {!checked ? (
        <>
          <div className="row" aria-label="Particle bank">
            {puzzle.bank.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className={selected === chip.id ? 'primary' : 'ghost'}
                aria-pressed={selected === chip.id}
                disabled={placedIds.has(chip.id)}
                onClick={() => tapChip(chip.id)}
                style={{ minWidth: '2.6rem', fontSize: '1.15rem' }}
              >
                {chip.text}
              </button>
            ))}
          </div>
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={!allFilled}
              onClick={() => onCheck(placements.map((id) => chipText(id)))}
            >
              Check
            </button>
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {allFilled
                ? 'Tap a filled blank to take its particle back.'
                : 'Tap a particle, then the blank it belongs in.'}
            </span>
          </div>
        </>
      ) : (
        <div className="stack" style={{ gap: '0.3rem' }} role="status">
          {checked.blanks
            .filter((blank) => !blank.correct)
            .map((blank, index) => (
              <div key={index}>
                ✗ You put <span className="jp">{blank.chosen}</span> — the original used{' '}
                <span className="jp">{blank.expected}</span>.
                {blank.plausibleAlternative ? (
                  <span className="muted">
                    {' '}
                    は / が / も swaps are often both natural; check the earlier lines for what is
                    already known.
                  </span>
                ) : null}
              </div>
            ))}
          {checked.allCorrect ? <div>✓ All {checked.blanks.length} correct.</div> : null}
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
  const [grade, setGrade] = useState<Grade | null>(null);
  const [results, setResults] = useState<Settled[]>([]);
  const shownAt = useRef(Date.now());
  const logged = useRef(false);
  const started = useRef(false);

  // Loaded once per visit (not live) so a Dexie refresh can't reshuffle mid-round.
  useEffect(() => {
    let cancelled = false;
    void getParticlePuzzleData().then((loaded) => {
      if (!cancelled) setData(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const newRound = useCallback(
    async (from: ParticlePuzzleData) => {
      const seed = `${Date.now()}:${Math.random()}`;
      const pick = pickItems(from.candidates, { signal, n: PARTICLE_PUZZLE_ROUND_SIZE, seed });
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
      setGrade(null);
      setResults([]);
      logged.current = false;
    },
    [signal],
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
  const totalBlanks = entries.reduce((sum, e) => sum + e.puzzle.answers.length, 0);
  const totalCorrect = results.reduce((sum, r) => sum + r.points, 0);

  function handleCheck(placements: string[]) {
    const graded = gradePuzzle(entry.puzzle, placements);
    setGrade(graded);
    setResults((prev) => [
      ...prev,
      {
        ref: entry.candidate.id,
        correct: graded.allCorrect,
        cluesUsed: 0,
        wrongGuesses: graded.blanks.length - graded.correctCount,
        points: graded.correctCount,
        ms: Date.now() - shownAt.current,
        parts: graded.blanks.map((blank) => ({
          key: blank.expected,
          correct: blank.correct,
          ...(blank.correct ? {} : { note: blank.chosen }),
        })),
        entry,
        grade: graded,
        why: describeParticlePick(pick.signal, entry.candidate.particles, focus),
      },
    ]);
  }

  function next() {
    if (index + 1 < total) {
      setIndex(index + 1);
      setGrade(null);
      shownAt.current = Date.now();
      return;
    }
    if (!logged.current) {
      logged.current = true;
      void logGameRound({
        gameId: PARTICLE_PUZZLE_GAME_ID,
        signal: pick.signal,
        poolSize: pick.poolSize,
        items: results.map(({ entry: _entry, grade: _grade, why: _why, ...item }) => item),
      });
    }
    setPhase('result');
  }

  return (
    <GameShell
      title="Particle Puzzle"
      phase={phase}
      progress={{ current: index + (grade ? 1 : 0), total }}
      intro={{
        signalLabel: pick.signal === 'any' ? 'Your sentences' : SIGNAL_LABELS[pick.signal],
        whyLine: describeRound(pick, PARTICLE_COPY),
        roundDescription: `${total} real sentences from your books with their particles removed, about 2 minutes. The translation stays hidden until you check.`,
        onStart: () => {
          shownAt.current = Date.now();
          setPhase('play');
        },
      }}
    >
      {phase === 'play' ? (
        <>
          <PuzzleCard key={entry.candidate.id} entry={entry} checked={grade} onCheck={handleCheck} />
          {grade ? (
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
              {totalCorrect} / {totalBlanks} particles
            </strong>{' '}
            <span className="muted">
              — {results.filter((r) => r.correct).length} of {total} sentences perfect
            </span>
          </div>
          {results.map((r) => (
            <div key={r.ref} className="stack" style={{ gap: '0.25rem' }}>
              <div className="jp jp-lg">
                {r.correct ? '✓ ' : '✗ '}
                {filledSentence(r.entry.puzzle)}
              </div>
              <div className="muted">{r.entry.candidate.sentence.translation}</div>
              {r.grade.blanks
                .filter((blank) => !blank.correct)
                .map((blank, i) => (
                  <div key={i} className="muted" style={{ fontSize: '0.85rem' }}>
                    You put {blank.chosen} where the original used {blank.expected}.
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
