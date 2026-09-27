import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  getHomophoneHuntData,
  getRecentGameDifficulty,
  logGameRound,
  type HomophoneClip,
} from '../../db/repository';
import type { GameRoundItem, GameSignal } from '../../domain/types';
import { useRangeLoop } from '../../hooks/useRangeLoop';
import { useSentenceAudioBlob } from '../../hooks/useSentenceAudioBlob';
import {
  describeRound,
  pickItems,
  SIGNAL_LABELS,
  type DifficultyTier,
  type PickResult,
} from '../../lib/gamePicker';
import {
  buildHomophoneCandidates,
  buildHomophoneRound,
  contrastPairKey,
  describeHomophonePick,
  HOMOPHONE_HUNT_COPY,
  HOMOPHONE_HUNT_GAME_ID,
  HOMOPHONE_HUNT_MIN_TRIALS,
  HOMOPHONE_HUNT_ROUND_SIZE,
  HOMOPHONE_TRIAL_POINTS,
  trialKey,
  type HomophoneCandidate,
} from '../../lib/homophoneHunt';
import { segmentIntoMorae } from '../../lib/mora';
import { findMinimalPairContrasts, type MinimalPairTrial } from '../../lib/pitchAccentMinimalPairs';
import { describePitchPattern } from '../../lib/pitchAccentShape';
import { seededShuffle } from '../../lib/seededShuffle';
import { WordPitchContour } from '../WordPitchContour';
import { GameShell, type GamePhase } from './GameShell';

type Data = Awaited<ReturnType<typeof getHomophoneHuntData>>;
type Trial = MinimalPairTrial<HomophoneClip>;
type Slot = 'first' | 'second';

interface Settled extends GameRoundItem {
  trial: Trial;
  why: string;
}

function ClipButton({
  label,
  clip,
  disabled,
}: {
  label: string;
  clip: HomophoneClip;
  disabled: boolean;
}) {
  const blob = useSentenceAudioBlob(clip.audio);
  const loop = useRangeLoop(clip.audio.id, blob);
  return (
    <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <audio ref={loop.audioElRef} src={loop.objectUrl ?? undefined} hidden />
      <button
        type="button"
        className={`speak-button${loop.isLooping ? ' speaking' : ''}`}
        onClick={() => void loop.toggleLoop(clip.span)}
        disabled={disabled || !blob}
      >
        {loop.isLooping ? '⏸' : '▶'} {label}
      </button>
      {loop.playbackError ? (
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          {loop.playbackError}
        </span>
      ) : null}
    </div>
  );
}

/** The measured pitch of just this word, cropped from its sentence clip's cached track. Renders nothing if unavailable. */
function ClipContour({ clip }: { clip: HomophoneClip }) {
  const blob = useSentenceAudioBlob(clip.audio);
  return (
    <WordPitchContour
      audioId={clip.audio.id}
      blob={blob}
      span={clip.span}
      ariaLabel={`Measured pitch of ${clip.expression}`}
    />
  );
}

function TrialView({
  trial,
  onSolved,
}: {
  trial: Trial;
  onSolved: (outcome: { correct: boolean; ms: number }) => void;
}) {
  const { a, b, sameBook } = trial;
  // Coin flip for which clip plays first — fixed for this trial's lifetime
  // (the parent remounts this component per trial via `key`).
  const [flipped] = useState(() => Math.random() < 0.5);
  const [guess, setGuess] = useState<Slot | null>(null);
  const startedAt = useRef(Date.now());

  const correctSlot: Slot = flipped ? 'second' : 'first';
  const moraCount = segmentIntoMorae(a.reading).length;
  const first = flipped ? b : a;
  const second = flipped ? a : b;

  function pick(slot: Slot) {
    if (guess) return;
    setGuess(slot);
    onSolved({ correct: slot === correctSlot, ms: Date.now() - startedAt.current });
  }

  return (
    <div className="stack" style={{ gap: '0.5rem' }}>
      <div>
        <strong>{a.reading}</strong> — {a.expression} ({describePitchPattern(a.position, moraCount)})
        {' vs. '}
        {b.expression} ({describePitchPattern(b.position, moraCount)})
      </div>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        {sameBook
          ? 'Same book — likely the same speaker.'
          : 'Different books — likely two different speakers.'}
      </p>
      <ClipButton label="Clip 1" clip={first} disabled={!!guess} />
      <ClipButton label="Clip 2" clip={second} disabled={!!guess} />
      <div className="muted">
        Which clip is <span className="jp">{a.expression}</span> ({a.meaning || a.reading})?
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" disabled={!!guess} onClick={() => pick('first')}>
          Clip 1
        </button>
        <button type="button" disabled={!!guess} onClick={() => pick('second')}>
          Clip 2
        </button>
      </div>
      {guess ? (
        <>
          <div role="status">
            <strong>
              {guess === correctSlot
                ? `✓ Right — Clip ${correctSlot === 'first' ? 1 : 2} was ${a.expression}.`
                : `✗ Actually Clip ${correctSlot === 'first' ? 1 : 2} was ${a.expression}.`}
            </strong>
          </div>
          <div className="row" style={{ alignItems: 'stretch' }}>
            <div className="stack" style={{ gap: '0.15rem', flex: '1 1 8rem' }}>
              <div className="jp">{a.expression}</div>
              <ClipContour clip={a} />
            </div>
            <div className="stack" style={{ gap: '0.15rem', flex: '1 1 8rem' }}>
              <div className="jp">{b.expression}</div>
              <ClipContour clip={b} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

interface Round {
  pick: PickResult<HomophoneCandidate>;
  trials: Trial[];
}

export function HomophoneHuntGame({ signal }: { signal: GameSignal }) {
  const [data, setData] = useState<Data | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [phase, setPhase] = useState<GamePhase>('intro');
  const [index, setIndex] = useState(0);
  const [settledNow, setSettledNow] = useState(false);
  const [results, setResults] = useState<Settled[]>([]);
  const logged = useRef(false);
  const started = useRef(false);
  const [difficulty, setDifficulty] = useState<DifficultyTier>('standard');

  // Loaded once per visit (not live) so a Dexie refresh can't reshuffle mid-round.
  useEffect(() => {
    let cancelled = false;
    void getHomophoneHuntData().then((loaded) => {
      if (!cancelled) setData(loaded);
    });
    void getRecentGameDifficulty(HOMOPHONE_HUNT_GAME_ID).then((tier) => {
      if (!cancelled) setDifficulty(tier);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const newRound = useCallback(
    (from: Data) => {
      const seed = `${Date.now()}:${Math.random()}`;
      const contrasts = findMinimalPairContrasts(from.clips);
      const candidates = buildHomophoneCandidates(contrasts, from.history);
      // The picker fixes the signal and the first pairs; the round then cycles
      // through them (then the rest) so a thin corpus with only one or two
      // real pairs can still fill a short round.
      const pick = pickItems(candidates, { signal, n: HOMOPHONE_HUNT_MIN_TRIALS, seed, difficulty });
      const rest = seededShuffle(
        candidates.filter((candidate) => !pick.items.some((p) => p.id === candidate.id)),
        (candidate) => candidate.id,
        `${seed}:rest`,
      );
      const shuffledClips = seededShuffle(
        from.clips,
        (clip) => `${clip.vocabularyItemId}:${clip.bookId}`,
        seed,
      );
      const trials = buildHomophoneRound(
        shuffledClips,
        [...pick.items, ...rest].map((candidate) => candidate.contrast),
        HOMOPHONE_HUNT_ROUND_SIZE,
      );
      setRound({ pick, trials });
      setPhase('intro');
      setIndex(0);
      setSettledNow(false);
      setResults([]);
      logged.current = false;
    },
    [signal, difficulty],
  );

  useEffect(() => {
    if (data && !started.current) {
      started.current = true;
      newRound(data);
    }
  }, [data, newRound]);

  if (!data || !round) return <p className="muted">Loading…</p>;

  const { pick, trials } = round;
  if (trials.length < HOMOPHONE_HUNT_MIN_TRIALS) {
    return (
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Homophone Hunt</h2>
        <p className="muted" style={{ margin: 0 }}>
          Needs two confirmed words that happen to be true homophones (same reading, different
          pitch-accent shape) with playable native clips — rare in most vocabularies. You have{' '}
          {data.clips.length} playable clip{data.clips.length === 1 ? '' : 's'} so far. Odd Ear
          Out (<Link to="/play">/play</Link>) trains the same skill without needing an exact
          homophone match.
        </p>
        <Link to="/play">Back to games</Link>
      </section>
    );
  }

  const trial = trials[index]!;
  const total = trials.length;
  const maxPoints = total * HOMOPHONE_TRIAL_POINTS;
  const totalPoints = results.reduce((sum, r) => sum + r.points, 0);

  function handleSolved({ correct, ms }: { correct: boolean; ms: number }) {
    setSettledNow(true);
    setResults((prev) => [
      ...prev,
      {
        ref: trialKey(trial),
        correct,
        cluesUsed: 0,
        wrongGuesses: correct ? 0 : 1,
        points: correct ? HOMOPHONE_TRIAL_POINTS : 0,
        ms,
        parts: [{ key: contrastPairKey(trial.contrast), correct }],
        trial,
        why: describeHomophonePick(pick.signal, trial.contrast, data!.history),
      },
    ]);
  }

  function next() {
    if (index + 1 < total) {
      setIndex(index + 1);
      setSettledNow(false);
      return;
    }
    if (!logged.current) {
      logged.current = true;
      void logGameRound({
        gameId: HOMOPHONE_HUNT_GAME_ID,
        signal: pick.signal,
        poolSize: pick.poolSize,
        items: results.map(({ trial: _trial, why: _why, ...item }) => item),
      });
    }
    setPhase('result');
  }

  return (
    <GameShell
      title="Homophone Hunt"
      phase={phase}
      progress={{ current: index + (settledNow ? 1 : 0), total }}
      intro={{
        signalLabel: pick.signal === 'any' ? 'Your words' : SIGNAL_LABELS[pick.signal],
        whyLine: describeRound(pick, HOMOPHONE_HUNT_COPY),
        roundDescription: `${total} rounds of two real native clips — same reading, different pitch-accent shape. Guess which clip is which, then see both measured contours. About 2 minutes. Wear headphones if you can.`,
        onStart: () => setPhase('play'),
      }}
    >
      {phase === 'play' ? (
        <>
          <TrialView key={trialKey(trial)} trial={trial} onSolved={handleSolved} />
          {settledNow ? (
            <div>
              <button type="button" className="primary" onClick={next}>
                {index + 1 < total ? 'Next pair' : 'See results'}
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
              — {results.filter((r) => r.correct).length} of {total} correct
            </span>
          </div>
          {results.map((r) => (
            <div key={r.ref} className="stack" style={{ gap: '0.2rem' }}>
              <div>
                {r.correct ? '✓ ' : '✗ '}
                <span className="jp">
                  {r.trial.a.expression} vs. {r.trial.b.expression}
                </span>{' '}
                <span className="muted">
                  — {r.trial.a.reading} · {r.points} / {HOMOPHONE_TRIAL_POINTS}
                </span>
              </div>
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                Why this pair: {r.why}
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
