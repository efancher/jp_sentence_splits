import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { getVerbLegoData, logGameRound } from '../../db/repository';
import type { GameRoundItem, GameSignal } from '../../domain/types';
import { describeRound, pickItems, SIGNAL_LABELS, type PickResult } from '../../lib/gamePicker';
import {
  buildVerbLegoPuzzle,
  chooseChain,
  describeChainPick,
  functionName,
  scoreVerbLego,
  VERB_LEGO_COPY,
  VERB_LEGO_GAME_ID,
  VERB_LEGO_ROUND_SIZE,
  verbLegoPointsAvailable,
  type VerbLegoCandidate,
  type VerbLegoPuzzle,
} from '../../lib/verbLego';
import { GameShell, type GamePhase } from './GameShell';

type Data = Awaited<ReturnType<typeof getVerbLegoData>>;
type Score = ReturnType<typeof scoreVerbLego>;

interface Settled extends GameRoundItem {
  puzzle: VerbLegoPuzzle;
  score: Score;
  why: string;
}

function Prompt({ puzzle }: { puzzle: VerbLegoPuzzle }) {
  const { chain } = puzzle;
  const functions = chain.pieces
    .slice(1)
    .map(functionName)
    // "ませ + ん" both read "polite … negative"; collapse a repeated neighbour.
    .filter((name, i, all) => name !== all[i - 1]);
  return (
    <div className="stack" style={{ gap: '0.2rem' }}>
      <div>
        <span className="jp jp-lg">{chain.lemma}</span>{' '}
        {chain.lemmaReading !== chain.lemma ? <span className="jp">{chain.lemmaReading}</span> : null}
        {chain.english ? <span className="muted"> — {chain.english}</span> : null}
      </div>
      <div>
        <strong>Build:</strong> {functions.join(' → ')}
      </div>
    </div>
  );
}

function LegoCard({
  puzzle,
  done,
  onComplete,
}: {
  puzzle: VerbLegoPuzzle;
  /** Set once every slot is filled — the final score. */
  done: Score | null;
  onComplete: (wrongTries: string[][]) => void;
}) {
  const { chain } = puzzle;
  const slotCount = puzzle.answers.length;
  // chip id locked into each slot, filled strictly left to right
  const [locked, setLocked] = useState<string[]>([]);
  const [wrongTries, setWrongTries] = useState<string[][]>(() => puzzle.answers.map(() => []));
  const [flash, setFlash] = useState<string | null>(null);
  const chipText = (id: string) => puzzle.bank.find((chip) => chip.id === id)?.text ?? '';
  const lockedTexts = locked.map(chipText);
  const wrongCount = wrongTries.reduce((sum, tries) => sum + tries.length, 0);
  const next = locked.length;

  // Tap-to-stack: a chip goes into the next open slot and is judged at once.
  function tapChip(id: string) {
    if (done || next >= slotCount || locked.includes(id)) return;
    const text = chipText(id);
    if (text === puzzle.answers[next]) {
      const nextLocked = [...locked, id];
      setLocked(nextLocked);
      setFlash(null);
      if (nextLocked.length === slotCount) onComplete(wrongTries);
    } else {
      setWrongTries((prev) => prev.map((tries, i) => (i === next ? [...tries, text] : tries)));
      setFlash(text);
    }
  }

  const built = lockedTexts.join('');
  const sentenceParts =
    chain.source === 'sentence'
      ? { before: chain.japanese.slice(0, chain.start), after: chain.japanese.slice(chain.end) }
      : null;

  return (
    <div className="stack">
      <Prompt puzzle={puzzle} />

      {sentenceParts ? (
        <div className="jp jp-lg">
          {sentenceParts.before}
          <mark>{built || '＿＿＿'}</mark>
          {sentenceParts.after}
        </div>
      ) : null}

      <div className="row" style={{ alignItems: 'flex-start', gap: '0.4rem' }} aria-label="Build slots">
        {puzzle.answers.map((_, index) => {
          const lockedId = locked[index];
          const isNext = index === next && !done;
          const flashed = isNext && flash;
          return (
            <div
              key={index}
              className="stack"
              style={{ gap: '0.15rem', flex: '1 1 4.5rem', minWidth: 0, textAlign: 'center' }}
            >
              <div
                aria-label={
                  lockedId
                    ? `Slot ${index + 1}: ${chipText(lockedId)}, correct`
                    : flashed
                      ? `Slot ${index + 1}: tried ${flash}, incorrect`
                      : `Slot ${index + 1}, empty`
                }
                className="jp jp-lg"
                style={{
                  padding: '0.3rem 0.4rem',
                  borderRadius: 'var(--radius)',
                  borderStyle: lockedId || flashed ? 'solid' : 'dashed',
                  borderWidth: 2,
                  borderColor: lockedId
                    ? 'var(--success)'
                    : flashed
                      ? 'var(--danger)'
                      : isNext
                        ? 'var(--accent)'
                        : 'var(--border)',
                  color: lockedId ? 'var(--success)' : flashed ? 'var(--danger)' : undefined,
                  minHeight: '2.4rem',
                }}
              >
                {lockedId ? `${chipText(lockedId)} ✓` : flashed ? `${flash} ✗` : '＿'}
              </div>
              <span className="muted" style={{ fontSize: '0.72rem', lineHeight: 1.2 }}>
                {puzzle.labels[index]}
              </span>
            </div>
          );
        })}
      </div>

      {!done ? (
        <>
          <div className="row" aria-label="Piece bank">
            {puzzle.bank.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className="ghost"
                disabled={locked.includes(chip.id)}
                onClick={() => tapChip(chip.id)}
                style={{ minWidth: '2.8rem', fontSize: '1.15rem' }}
              >
                {chip.text}
              </button>
            ))}
          </div>
          <div className="row" role="status">
            <strong>Worth {verbLegoPointsAvailable(slotCount, wrongCount)} now</strong>
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {flash
                ? `✗ Not ${flash} there — that cost a point.`
                : 'Tap the piece that goes in the next slot. Each wrong pick costs a point.'}
            </span>
          </div>
        </>
      ) : (
        <div className="stack" style={{ gap: '0.3rem' }} role="status">
          <div>
            <strong>
              {done.allCorrect ? '✓ Clean — ' : ''}
              {done.points} / {done.maxPoints} points
            </strong>{' '}
            <span className="jp jp-lg">{built}</span>
          </div>
          {done.slots
            .filter((slot) => !slot.correct)
            .map((slot, index) => (
              <div key={index}>
                ✗ For <span className="jp">{slot.expected}</span> you tried{' '}
                <span className="jp">{slot.wrongTries.join('・')}</span> first.
              </div>
            ))}
          {chain.source === 'sentence' && chain.translation ? (
            <div className="muted">{chain.translation}</div>
          ) : (
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              Built from a verb in your vocabulary — the form is composed by rule, not taken from a
              sentence.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Round {
  pick: PickResult<VerbLegoCandidate>;
  puzzles: VerbLegoPuzzle[];
}

export function VerbLegoGame({ signal }: { signal: GameSignal }) {
  const [data, setData] = useState<Data | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [phase, setPhase] = useState<GamePhase>('intro');
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState<Score | null>(null);
  const [results, setResults] = useState<Settled[]>([]);
  const shownAt = useRef(Date.now());
  const logged = useRef(false);
  const started = useRef(false);

  // Loaded once per visit (not live) so a Dexie refresh can't reshuffle mid-round.
  useEffect(() => {
    let cancelled = false;
    void getVerbLegoData().then((loaded) => {
      if (!cancelled) setData(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const newRound = useCallback(
    (from: Data) => {
      const seed = `${Date.now()}:${Math.random()}`;
      const pick = pickItems(from.candidates, { signal, n: VERB_LEGO_ROUND_SIZE, seed });
      const puzzles = pick.items.map((candidate) => {
        const chain = chooseChain(candidate, `${seed}:${candidate.id}`);
        return buildVerbLegoPuzzle(chain, `${seed}:${chain.id}`);
      });
      setRound({ pick, puzzles });
      setPhase('intro');
      setIndex(0);
      setScore(null);
      setResults([]);
      logged.current = false;
    },
    [signal],
  );

  useEffect(() => {
    if (data && !started.current) {
      started.current = true;
      newRound(data);
    }
  }, [data, newRound]);

  if (!data || !round) return <p className="muted">Loading…</p>;

  const { pick, puzzles } = round;
  if (puzzles.length < VERB_LEGO_ROUND_SIZE) {
    return (
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Verb Lego</h2>
        <p className="muted" style={{ margin: 0 }}>
          Needs at least {VERB_LEGO_ROUND_SIZE} different verb-form patterns — from sentences whose
          vocabulary you&apos;ve confirmed, or from confirmed verbs JMdict tags as godan or ichidan.
          You have {data.candidates.length} so far.
        </p>
        <Link to="/play">Back to games</Link>
      </section>
    );
  }

  const focus = data.focus;
  const puzzle = puzzles[index]!;
  const total = puzzles.length;
  const maxPoints = puzzles.reduce((sum, p) => sum + p.answers.length, 0);
  const totalPoints = results.reduce((sum, r) => sum + r.points, 0);

  function handleComplete(wrongTries: string[][]) {
    const scored = scoreVerbLego(puzzle, wrongTries);
    setScore(scored);
    setResults((prev) => [
      ...prev,
      {
        ref: puzzle.chain.id,
        correct: scored.allCorrect,
        cluesUsed: 0,
        wrongGuesses: scored.wrongCount,
        points: scored.points,
        ms: Date.now() - shownAt.current,
        parts: scored.slots.map((slot) => ({
          key: slot.key,
          correct: slot.correct,
          ...(slot.correct ? {} : { note: slot.wrongTries[0] }),
        })),
        puzzle,
        score: scored,
        why: describeChainPick(pick.signal, puzzle.chain, focus),
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
        gameId: VERB_LEGO_GAME_ID,
        signal: pick.signal,
        poolSize: pick.poolSize,
        items: results.map(({ puzzle: _puzzle, score: _score, why: _why, ...item }) => item),
      });
    }
    setPhase('result');
  }

  return (
    <GameShell
      title="Verb Lego"
      phase={phase}
      progress={{ current: index + (score ? 1 : 0), total }}
      intro={{
        signalLabel: pick.signal === 'any' ? 'Your verbs' : SIGNAL_LABELS[pick.signal],
        whyLine: describeRound(pick, VERB_LEGO_COPY),
        roundDescription: `${total} verb forms to build piece by piece — some from your own sentences, some composed from verbs you know (like 食べさせられなかった). About 2 minutes. A form starts worth one point per piece and loses one for every wrong pick.`,
        onStart: () => {
          shownAt.current = Date.now();
          setPhase('play');
        },
      }}
    >
      {phase === 'play' ? (
        <>
          <LegoCard key={puzzle.chain.id} puzzle={puzzle} done={score} onComplete={handleComplete} />
          {score ? (
            <div>
              <button type="button" className="primary" onClick={next}>
                {index + 1 < total ? 'Next form' : 'See results'}
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
              — {results.filter((r) => r.correct).length} of {total} with no wrong picks
            </span>
          </div>
          {results.map((r) => (
            <div key={r.ref} className="stack" style={{ gap: '0.2rem' }}>
              <div>
                {r.correct ? '✓ ' : ''}
                <span className="jp jp-lg">{r.puzzle.answers.join('')}</span>{' '}
                <span className="muted">
                  {r.points} / {r.score.maxPoints} ·{' '}
                  {r.puzzle.chain.source === 'sentence' ? 'from your sentence' : 'built from your vocabulary'}
                </span>
              </div>
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                {r.puzzle.chain.pieces.map((p) => p.text).join(' + ')} · {r.puzzle.chain.lemma}
                {r.puzzle.chain.english ? ` (${r.puzzle.chain.english})` : ''}
              </div>
              {r.puzzle.chain.source === 'sentence' ? (
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  {r.puzzle.chain.japanese} — {r.puzzle.chain.translation}
                </div>
              ) : null}
              {r.score.slots
                .filter((slot) => !slot.correct)
                .map((slot, i) => (
                  <div key={i} className="muted" style={{ fontSize: '0.85rem' }}>
                    For {slot.expected} you tried {slot.wrongTries.join('・')} first.
                  </div>
                ))}
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                Why this form: {r.why}
              </div>
            </div>
          ))}
          <div className="row">
            <button type="button" className="primary" onClick={() => newRound(data)}>
              Play again
            </button>
            <Link to="/play">All games</Link>
          </div>
        </div>
      ) : null}
    </GameShell>
  );
}
