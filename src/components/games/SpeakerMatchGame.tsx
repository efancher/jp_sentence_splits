import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  getRecentGameDifficulty,
  getSpeakerMatchData,
  logGameRound,
  type SpeakerMatchClip,
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
  buildSpeakerMatchCandidates,
  buildSpeakerMatchRound,
  describeSpeakerMatchPick,
  speakerMatchKey,
  SPEAKER_MATCH_COPY,
  SPEAKER_MATCH_GAME_ID,
  SPEAKER_MATCH_MIN_TRIALS,
  SPEAKER_MATCH_ROUND_SIZE,
  SPEAKER_MATCH_TRIAL_POINTS,
  type SpeakerMatchCandidate,
  type SpeakerMatchTrial,
} from '../../lib/speakerMatch';
import { seededShuffle } from '../../lib/seededShuffle';
import { WordPitchContour } from '../WordPitchContour';
import { GameShell, type GamePhase } from './GameShell';

type Data = Awaited<ReturnType<typeof getSpeakerMatchData>>;
type Trial = SpeakerMatchTrial<SpeakerMatchClip>;
type Slot = 'first' | 'second';

interface Settled extends GameRoundItem {
  trial: Trial;
  why: string;
}

function ClipButton({ label, clip, disabled }: { label: string; clip: SpeakerMatchClip; disabled: boolean }) {
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
function ClipContour({ clip }: { clip: SpeakerMatchClip }) {
  const blob = useSentenceAudioBlob(clip.audio);
  return (
    <WordPitchContour
      audioId={clip.audio.id}
      blob={blob}
      span={clip.span}
      ariaLabel={`Measured pitch of ${clip.expression} in ${clip.bookTitle}`}
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
  const { a, b, word } = trial;
  // Coin flip for which clip plays first, and which book is the target — both
  // fixed for this trial's lifetime (the parent remounts via `key`).
  const [flipped] = useState(() => Math.random() < 0.5);
  const [targetIsA] = useState(() => Math.random() < 0.5);
  const [guess, setGuess] = useState<Slot | null>(null);
  const startedAt = useRef(Date.now());

  const target = targetIsA ? a : b;
  const correctSlot: Slot = flipped ? (targetIsA ? 'second' : 'first') : targetIsA ? 'first' : 'second';
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
        <span className="jp jp-lg">{word.expression}</span> — {word.reading}
        {word.meaning ? <span className="muted"> ({word.meaning})</span> : null}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        Two real clips of the same word, from two different books.
      </p>
      <ClipButton label="Clip 1" clip={first} disabled={!!guess} />
      <ClipButton label="Clip 2" clip={second} disabled={!!guess} />
      <div className="muted">
        Which clip is from <strong>{target.bookTitle}</strong>?
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
                ? `✓ Right — Clip ${correctSlot === 'first' ? 1 : 2} was ${target.bookTitle}'s.`
                : `✗ Actually Clip ${correctSlot === 'first' ? 1 : 2} was ${target.bookTitle}'s.`}
            </strong>
          </div>
          <div className="row" style={{ alignItems: 'stretch' }}>
            <div className="stack" style={{ gap: '0.15rem', flex: '1 1 8rem' }}>
              <div className="muted">{a.bookTitle}</div>
              <ClipContour clip={a} />
            </div>
            <div className="stack" style={{ gap: '0.15rem', flex: '1 1 8rem' }}>
              <div className="muted">{b.bookTitle}</div>
              <ClipContour clip={b} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

interface Round {
  pick: PickResult<SpeakerMatchCandidate<SpeakerMatchClip>>;
  trials: Trial[];
}

export function SpeakerMatchGame({ signal }: { signal: GameSignal }) {
  const [data, setData] = useState<Data | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [phase, setPhase] = useState<GamePhase>('intro');
  const [index, setIndex] = useState(0);
  const [settledNow, setSettledNow] = useState(false);
  const [results, setResults] = useState<Settled[]>([]);
  const logged = useRef(false);
  const started = useRef(false);
  const [difficulty, setDifficulty] = useState<DifficultyTier>('standard');

  useEffect(() => {
    let cancelled = false;
    void getSpeakerMatchData().then((loaded) => {
      if (!cancelled) setData(loaded);
    });
    void getRecentGameDifficulty(SPEAKER_MATCH_GAME_ID).then((tier) => {
      if (!cancelled) setDifficulty(tier);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const newRound = useCallback(
    (from: Data) => {
      const seed = `${Date.now()}:${Math.random()}`;
      const candidates = buildSpeakerMatchCandidates(from.comparisons, from.history);
      const pick = pickItems(candidates, { signal, n: SPEAKER_MATCH_ROUND_SIZE, seed, difficulty });
      const rest = seededShuffle(
        candidates.filter((candidate) => !pick.items.some((p) => p.id === candidate.id)),
        (candidate) => candidate.id,
        `${seed}:rest`,
      );
      const trials = buildSpeakerMatchRound(
        [...pick.items, ...rest].map((candidate) => candidate.comparison),
        SPEAKER_MATCH_ROUND_SIZE,
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
  if (trials.length < SPEAKER_MATCH_MIN_TRIALS) {
    return (
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Speaker Match</h2>
        <p className="muted" style={{ margin: 0 }}>
          Needs confirmed words mined from playable native clips in two or more different books —
          rare unless the same word turns up across several books. You have {data.comparisons.length}{' '}
          word{data.comparisons.length === 1 ? '' : 's'} with clips so far. The "Compare speakers"
          browse tool (<Link to="/pitch-accent/compare">/pitch-accent/compare</Link>) shows the same
          pool without the round.
        </p>
        <Link to="/play">Back to games</Link>
      </section>
    );
  }

  const trial = trials[index]!;
  const total = trials.length;
  const maxPoints = total * SPEAKER_MATCH_TRIAL_POINTS;
  const totalPoints = results.reduce((sum, r) => sum + r.points, 0);

  function handleSolved({ correct, ms }: { correct: boolean; ms: number }) {
    setSettledNow(true);
    setResults((prev) => [
      ...prev,
      {
        ref: speakerMatchKey(trial.word),
        correct,
        cluesUsed: 0,
        wrongGuesses: correct ? 0 : 1,
        points: correct ? SPEAKER_MATCH_TRIAL_POINTS : 0,
        ms,
        parts: [{ key: speakerMatchKey(trial.word), correct }],
        trial,
        why: describeSpeakerMatchPick(pick.signal, trial.word, data!.history),
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
        gameId: SPEAKER_MATCH_GAME_ID,
        signal: pick.signal,
        poolSize: pick.poolSize,
        items: results.map(({ trial: _trial, why: _why, ...item }) => item),
      });
    }
    setPhase('result');
  }

  return (
    <GameShell
      title="Speaker Match"
      phase={phase}
      progress={{ current: index + (settledNow ? 1 : 0), total }}
      intro={{
        signalLabel: pick.signal === 'any' ? 'Your words' : SIGNAL_LABELS[pick.signal],
        whyLine: describeRound(pick, SPEAKER_MATCH_COPY),
        roundDescription: `${total} rounds of two real native clips of the same word, from two different books. Guess which clip belongs to the named book. About 2 minutes. Wear headphones if you can.`,
        onStart: () => setPhase('play'),
      }}
    >
      {phase === 'play' ? (
        <>
          <TrialView key={speakerMatchKey(trial.word)} trial={trial} onSolved={handleSolved} />
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
                <span className="jp">{r.trial.word.expression}</span>{' '}
                <span className="muted">
                  — {r.trial.word.reading} · {r.points} / {SPEAKER_MATCH_TRIAL_POINTS}
                </span>
              </div>
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                Why this word: {r.why}
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
