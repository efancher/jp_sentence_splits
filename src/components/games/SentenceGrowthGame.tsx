import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { getSentenceGrowthCandidates, logGameRound, type RemixCandidate } from '../../db/repository';
import type { GameRoundItem, GameSignal } from '../../domain/types';
import { seededShuffle } from '../../lib/seededShuffle';
import {
  buildGrowthPlan,
  GROWTH_RATINGS,
  SENTENCE_GROWTH_GAME_ID,
  SENTENCE_GROWTH_ROUND_SIZE,
  type GrowthPlan,
  type GrowthSelfRating,
} from '../../lib/sentenceGrowth';
import { NativeAudioButton } from '../NativeAudioButton';
import { GameShell, type GamePhase } from './GameShell';

interface Entry {
  candidate: RemixCandidate;
  plan: GrowthPlan;
}

interface Settled extends GameRoundItem {
  entry: Entry;
}

interface CardResult {
  wrong: number;
  rating: GrowthSelfRating;
  missedParticles: string[];
}

/** Where the learner is in one sentence: asking for chunk `n`, saying it aloud, or rating. */
type Step = { kind: 'ask'; n: number } | { kind: 'say' } | { kind: 'rate' };

function GrowthCard({ entry, onComplete }: { entry: Entry; onComplete: (result: CardResult) => void }) {
  const { plan, candidate } = entry;
  const [step, setStep] = useState<Step>({ kind: 'ask', n: 0 });
  const [wrong, setWrong] = useState(0);
  const [lastMiss, setLastMiss] = useState<string | null>(null);
  const [rated, setRated] = useState<GrowthSelfRating | null>(null);
  const missed = useRef(new Set<string>());
  // Option order is fixed per sentence so a re-render never reshuffles the buttons under the finger.
  const order = useRef(
    seededShuffle(
      plan.chunks.map((_, index) => index),
      String,
      candidate.id,
    ),
  );

  const placed = new Set(step.kind === 'ask' ? plan.promptOrder.slice(0, step.n) : plan.promptOrder);
  const targetIndex = step.kind === 'ask' ? plan.promptOrder[step.n]! : null;
  const target = targetIndex === null ? null : plan.chunks[targetIndex]!;

  function pick(index: number) {
    if (step.kind !== 'ask' || targetIndex === null) return;
    if (index === targetIndex) {
      setLastMiss(null);
      setStep(step.n + 1 < plan.promptOrder.length ? { kind: 'ask', n: step.n + 1 } : { kind: 'say' });
      return;
    }
    setWrong((count) => count + 1);
    missed.current.add(plan.chunks[targetIndex]!.particle);
    setLastMiss(plan.chunks[index]!.text);
  }

  function rate(rating: GrowthSelfRating) {
    setRated(rating);
    onComplete({ wrong, rating, missedParticles: [...missed.current] });
  }

  return (
    <div className="stack">
      <div className="row" style={{ alignItems: 'center' }}>
        <NativeAudioButton audio={candidate.audio} displayLabel="Hear the sentence" />
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          A real sentence from your books. Replay as often as you like.
        </span>
      </div>

      <div
        className="row jp jp-lg"
        style={{ flexWrap: 'wrap', gap: '0.4rem', alignItems: 'flex-start' }}
        aria-label="Sentence so far"
      >
        {plan.chunks.map((chunk, index) => {
          const filled = placed.has(index);
          const asking = index === targetIndex;
          return (
            <span key={index} className="stack" style={{ gap: '0.1rem' }}>
              <span
                style={{
                  padding: '0.1rem 0.4rem',
                  borderRadius: 'var(--radius)',
                  border: `2px ${filled ? 'solid' : 'dashed'} ${
                    filled ? 'var(--success)' : asking ? 'var(--accent)' : 'var(--border)'
                  }`,
                  color: filled ? 'var(--success)' : undefined,
                  minWidth: '2.5rem',
                  display: 'inline-block',
                  textAlign: 'center',
                }}
              >
                {filled ? chunk.text : '＿＿'}
              </span>
              {asking ? (
                <span className="muted" style={{ fontSize: '0.7rem', fontFamily: 'inherit' }}>
                  ← asking about this
                </span>
              ) : null}
            </span>
          );
        })}
        <span className="stack" style={{ gap: '0.1rem' }}>
          <span>{plan.verbText}</span>
          <span className="muted" style={{ fontSize: '0.7rem', fontFamily: 'inherit' }}>
            the core
          </span>
        </span>
      </div>

      {step.kind === 'ask' && target ? (
        <div className="stack" style={{ gap: '0.5rem' }}>
          <strong>
            {target.question}{' '}
            <span className="muted">
              ({step.n + 1} of {plan.promptOrder.length})
            </span>
          </strong>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            Listen to the clip, then pick the piece of this sentence that answers it. The{' '}
            <span className="jp">{target.particle}</span> particle marks {target.hint}.
            {target.gloss ? ` Hint: “${target.gloss}”.` : ''}
          </span>
          <div className="row" style={{ flexWrap: 'wrap' }} role="group" aria-label="Pieces of the sentence">
            {order.current
              .filter((index) => !placed.has(index))
              .map((index) => (
                <button key={index} type="button" className="jp" onClick={() => pick(index)}>
                  {plan.chunks[index]!.text}
                </button>
              ))}
          </div>
          {lastMiss ? (
            <span style={{ fontSize: '0.8rem', color: 'var(--danger)' }} role="status">
              ✗ {lastMiss} isn’t the answer to that question — try another piece.
            </span>
          ) : null}
        </div>
      ) : null}

      {step.kind === 'say' ? (
        <div className="stack" style={{ gap: '0.5rem' }}>
          <strong>Now say the whole sentence out loud</strong>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            Play the clip, then say it along with the recording. Nothing is recorded or scored.
          </span>
          <div>
            <button type="button" className="primary" onClick={() => setStep({ kind: 'rate' })}>
              I’ve said it — show the meaning
            </button>
          </div>
        </div>
      ) : null}

      {step.kind === 'rate' ? (
        <div className="stack" style={{ gap: '0.5rem' }} role="status">
          <div className="jp jp-lg">{candidate.sentence.japanese}</div>
          <div className="muted">{candidate.sentence.translation}</div>
          {rated ? (
            <span className="muted">Rated: {GROWTH_RATINGS.find((r) => r.value === rated)?.label}.</span>
          ) : (
            <div className="stack" style={{ gap: '0.35rem' }}>
              <strong>How did saying it go?</strong>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {GROWTH_RATINGS.map((option) => (
                  <button key={option.value} type="button" title={option.hint} onClick={() => rate(option.value)}>
                    {option.label}
                  </button>
                ))}
              </div>
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                Hard = {GROWTH_RATINGS[0]!.hint}; Okay = {GROWTH_RATINGS[1]!.hint}; Easy = {GROWTH_RATINGS[2]!.hint}.
              </span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function SentenceGrowthGame({ signal: _signal }: { signal: GameSignal }) {
  const [candidates, setCandidates] = useState<RemixCandidate[] | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [phase, setPhase] = useState<GamePhase>('intro');
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [results, setResults] = useState<Settled[]>([]);
  const shownAt = useRef(Date.now());
  const logged = useRef(false);
  const started = useRef(false);

  // Loaded once per visit (not live) so a Dexie refresh can't reshuffle mid-round.
  useEffect(() => {
    let cancelled = false;
    void getSentenceGrowthCandidates().then((loaded) => {
      if (!cancelled) setCandidates(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const newRound = useCallback((from: RemixCandidate[]) => {
    const seed = `${Date.now()}:${Math.random()}`;
    const picked = seededShuffle(from, (candidate) => candidate.id, seed)
      .slice(0, SENTENCE_GROWTH_ROUND_SIZE)
      .flatMap((candidate) => {
        const plan = buildGrowthPlan(candidate.sentence);
        return plan ? [{ candidate, plan }] : [];
      });
    setEntries(picked);
    setPhase('intro');
    setIndex(0);
    setDone(false);
    setResults([]);
    logged.current = false;
  }, []);

  useEffect(() => {
    if (candidates && !started.current) {
      started.current = true;
      newRound(candidates);
    }
  }, [candidates, newRound]);

  if (!candidates || !entries) return <p className="muted">Loading…</p>;

  if (entries.length < SENTENCE_GROWTH_ROUND_SIZE) {
    return (
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Sentence Growth</h2>
        <p className="muted" style={{ margin: 0 }}>
          Needs at least {SENTENCE_GROWTH_ROUND_SIZE} sentences you&apos;ve met, with native audio, a translation, a
          single clause and two or more noun + particle chunks before the verb — you have {candidates.length} so far.
        </p>
        <Link to="/play">Back to games</Link>
      </section>
    );
  }

  const entry = entries[index]!;
  const total = entries.length;

  function handleComplete(result: CardResult) {
    setDone(true);
    setResults((prev) => [
      ...prev,
      {
        ref: entry.candidate.id,
        correct: result.wrong === 0,
        cluesUsed: 0,
        wrongGuesses: result.wrong,
        points: 0,
        ms: Date.now() - shownAt.current,
        selfRating: result.rating,
        parts: entry.plan.chunks.map((chunk) => ({
          key: chunk.particle,
          correct: !result.missedParticles.includes(chunk.particle),
        })),
        entry,
      },
    ]);
  }

  function next() {
    if (index + 1 < total) {
      setIndex(index + 1);
      setDone(false);
      shownAt.current = Date.now();
      return;
    }
    if (!logged.current) {
      logged.current = true;
      void logGameRound({
        gameId: SENTENCE_GROWTH_GAME_ID,
        signal: 'any',
        poolSize: candidates?.length ?? 0,
        items: results.map(({ entry: _entry, ...item }) => item),
      });
    }
    setPhase('result');
  }

  return (
    <GameShell
      title="Sentence Growth"
      phase={phase}
      progress={{ current: index + (done ? 1 : 0), total }}
      intro={{
        signalLabel: 'Your sentences',
        whyLine: 'Sentences you have met, with native audio.',
        roundDescription: `${total} real sentences, about 4 minutes. Hear one and see only its verb; then rebuild it one piece at a time — who, what, where — picking each from the sentence's own pieces. Finally say the whole sentence along with the clip and rate how it went yourself.`,
        onStart: () => {
          shownAt.current = Date.now();
          setPhase('play');
        },
      }}
    >
      {phase === 'play' ? (
        <>
          <GrowthCard key={entry.candidate.id} entry={entry} onComplete={handleComplete} />
          {done ? (
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
          {results.map((r) => (
            <div key={r.ref} className="stack" style={{ gap: '0.25rem' }}>
              <div className="jp jp-lg">{r.entry.candidate.sentence.japanese}</div>
              <div className="muted">{r.entry.candidate.sentence.translation}</div>
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                {r.wrongGuesses === 0
                  ? 'Every piece picked first time.'
                  : `${r.wrongGuesses} wrong pick${r.wrongGuesses === 1 ? '' : 's'} while rebuilding.`}{' '}
                You rated it: {GROWTH_RATINGS.find((o) => o.value === r.selfRating)?.label}.
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
