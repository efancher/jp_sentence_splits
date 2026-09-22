import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  getOddEarOutData,
  getRecentGameDifficulty,
  logGameRound,
  type OddEarOutClip,
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
  buildContrastCandidates,
  buildOddEarRound,
  describeOddEarPick,
  MAJORITY_SIZE,
  ODD_EAR_COPY,
  ODD_EAR_MIN_TRIALS,
  ODD_EAR_OUT_GAME_ID,
  ODD_EAR_TRIAL_POINTS,
  oddEarPointsAvailable,
  shapeLabel,
  type OddEarCandidate,
  type OddEarTrial,
} from '../../lib/oddEarOut';
import { seededShuffle } from '../../lib/seededShuffle';
import { WordPitchContour } from '../WordPitchContour';
import { GameShell, type GamePhase } from './GameShell';

type Data = Awaited<ReturnType<typeof getOddEarOutData>>;
type Trial = OddEarTrial<OddEarOutClip>;

interface Settled extends GameRoundItem {
  trial: Trial;
  why: string;
}

/** The measured pitch of just this word, cropped from its sentence clip's cached track. Renders nothing if unavailable. */
function WordContour({ clip, blob }: { clip: OddEarOutClip; blob: Blob | null }) {
  return (
    <WordPitchContour
      audioId={clip.audio.id}
      blob={blob}
      span={clip.span}
      ariaLabel={`Measured pitch of ${clip.expression}`}
    />
  );
}

type TileState = 'idle' | 'wrong' | 'odd';

function ClipTile({
  clip,
  number,
  state,
  revealed,
  isOdd,
  playingId,
  onPlay,
  onPick,
  pickDisabled,
}: {
  clip: OddEarOutClip;
  number: number;
  state: TileState;
  revealed: boolean;
  isOdd: boolean;
  playingId: string | null;
  onPlay: (id: string | null) => void;
  onPick: () => void;
  pickDisabled: boolean;
}) {
  const tileId = `${clip.vocabularyItemId}:${clip.bookId}`;
  const blob = useSentenceAudioBlob(clip.audio);
  const loop = useRangeLoop(clip.audio.id, blob);
  const loopRef = useRef(loop);
  loopRef.current = loop;

  // Only one clip sounds at a time: when another tile takes over, stop this one.
  useEffect(() => {
    if (playingId !== tileId && loopRef.current.isLooping) loopRef.current.cancel();
  }, [playingId, tileId]);

  function togglePlay() {
    if (loop.isLooping) {
      onPlay(null);
      loop.cancel();
      return;
    }
    onPlay(tileId);
    void loop.toggleLoop(clip.span);
  }

  const border =
    state === 'odd' ? 'var(--success)' : state === 'wrong' ? 'var(--danger)' : 'var(--border)';
  return (
    <div
      className="stack"
      style={{
        gap: '0.4rem',
        padding: '0.6rem',
        border: `2px solid ${border}`,
        borderRadius: 'var(--radius)',
        flex: '1 1 8rem',
        minWidth: 0,
      }}
    >
      <audio ref={loop.audioElRef} src={loop.objectUrl ?? undefined} hidden />
      <button
        type="button"
        className={`speak-button${loop.isLooping ? ' speaking' : ''}`}
        onClick={togglePlay}
        disabled={!blob}
        aria-label={`${loop.isLooping ? 'Stop' : 'Play'} clip ${number}`}
      >
        {loop.isLooping ? '⏸' : '▶'} Clip {number}
      </button>
      {loop.playbackError ? (
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          {loop.playbackError}
        </span>
      ) : null}
      {!revealed ? (
        <button
          type="button"
          className="ghost"
          disabled={pickDisabled || state === 'wrong'}
          onClick={onPick}
          aria-label={`Clip ${number} is the odd one`}
        >
          {state === 'wrong' ? '✗ Not this one' : 'This one'}
        </button>
      ) : (
        <div className="stack" style={{ gap: '0.15rem' }}>
          <div>
            {isOdd ? '✓ ' : ''}
            <span className="jp jp-lg">{clip.expression}</span>{' '}
            <span className="jp">{clip.reading}</span>
          </div>
          {clip.meaning ? <div className="muted" style={{ fontSize: '0.85rem' }}>{clip.meaning}</div> : null}
          <div style={{ fontSize: '0.85rem' }}>{shapeLabel(clip.shape)}</div>
          <WordContour clip={clip} blob={blob} />
        </div>
      )}
    </div>
  );
}

function TrialView({
  trial,
  onSolved,
}: {
  trial: Trial;
  onSolved: (outcome: { wrongCount: number; ms: number }) => void;
}) {
  const [wrong, setWrong] = useState<Set<number>>(() => new Set());
  const [solved, setSolved] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const startedAt = useRef(Date.now());

  function pick(index: number) {
    if (solved || wrong.has(index)) return;
    if (index === trial.oddIndex) {
      setSolved(true);
      onSolved({ wrongCount: wrong.size, ms: Date.now() - startedAt.current });
    } else {
      setWrong((prev) => new Set(prev).add(index));
    }
  }

  return (
    <div className="stack">
      <div>
        <strong>Which one is different?</strong>{' '}
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          Three of these words share an accent shape; one doesn&apos;t.
        </span>
      </div>
      <div className="row" style={{ alignItems: 'stretch' }}>
        {trial.clips.map((clip, index) => (
          <ClipTile
            key={`${clip.vocabularyItemId}:${clip.bookId}`}
            clip={clip}
            number={index + 1}
            state={solved && index === trial.oddIndex ? 'odd' : wrong.has(index) ? 'wrong' : 'idle'}
            revealed={solved}
            isOdd={index === trial.oddIndex}
            playingId={playingId}
            onPlay={setPlayingId}
            onPick={() => pick(index)}
            pickDisabled={solved}
          />
        ))}
      </div>
      <div className="row" role="status">
        {!solved ? (
          <>
            <strong>Worth {oddEarPointsAvailable(wrong.size)} now</strong>
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {wrong.size > 0
                ? '✗ Not that one — it cost a point.'
                : 'Tap ▶ to hear each clip, then tap “This one” under the odd one. Each wrong pick costs a point.'}
            </span>
          </>
        ) : (
          <strong>
            {wrong.size === 0 ? '✓ Clean — ' : ''}
            {oddEarPointsAvailable(wrong.size)} / {ODD_EAR_TRIAL_POINTS} points
          </strong>
        )}
      </div>
      {trial.sameBook ? (
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          All four from the same book — likely the same speaker.
        </span>
      ) : (
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          Mixed books — the voices may differ; listen to the pitch, not the voice.
        </span>
      )}
    </div>
  );
}

interface Round {
  pick: PickResult<OddEarCandidate>;
  trials: Trial[];
}

export function OddEarOutGame({ signal }: { signal: GameSignal }) {
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
    void getOddEarOutData().then((loaded) => {
      if (!cancelled) setData(loaded);
    });
    void getRecentGameDifficulty(ODD_EAR_OUT_GAME_ID).then((tier) => {
      if (!cancelled) setDifficulty(tier);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const newRound = useCallback(
    (from: Data) => {
      const seed = `${Date.now()}:${Math.random()}`;
      const candidates = buildContrastCandidates(from.clips, from.history);
      // The picker fixes the signal and the first contrasts; the round then cycles
      // through them (then the remaining contrasts) with fresh words each time, so a
      // corpus with only a few contrasts still fills a round.
      const pick = pickItems(candidates, { signal, n: ODD_EAR_MIN_TRIALS, seed, difficulty });
      const rest = seededShuffle(
        candidates.filter((candidate) => !pick.items.some((p) => p.id === candidate.id)),
        (candidate) => candidate.id,
        `${seed}:rest`,
      );
      const trials = buildOddEarRound(
        from.clips,
        [...pick.items, ...rest].map((candidate) => candidate.contrast),
        seed,
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
  if (trials.length < ODD_EAR_MIN_TRIALS) {
    return (
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Odd Ear Out</h2>
        <p className="muted" style={{ margin: 0 }}>
          Needs enough words with native audio to build at least {ODD_EAR_MIN_TRIALS} rounds — groups
          of {MAJORITY_SIZE}+ same-length words sharing an accent shape, plus a word of another
          shape to contrast, no word used twice. You have {data.clips.length} playable words so
          far.
        </p>
        <Link to="/play">Back to games</Link>
      </section>
    );
  }

  const trial = trials[index]!;
  const total = trials.length;
  const maxPoints = total * ODD_EAR_TRIAL_POINTS;
  const totalPoints = results.reduce((sum, r) => sum + r.points, 0);

  function handleSolved({ wrongCount, ms }: { wrongCount: number; ms: number }) {
    setSettledNow(true);
    setResults((prev) => [
      ...prev,
      {
        ref: trial.id,
        correct: wrongCount === 0,
        cluesUsed: 0,
        wrongGuesses: wrongCount,
        points: oddEarPointsAvailable(wrongCount),
        ms,
        parts: [{ key: trial.contrast.pairKey, correct: wrongCount === 0 }],
        trial,
        why: describeOddEarPick(pick.signal, trial.contrast, data!.history),
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
        gameId: ODD_EAR_OUT_GAME_ID,
        signal: pick.signal,
        poolSize: pick.poolSize,
        items: results.map(({ trial: _trial, why: _why, ...item }) => item),
      });
    }
    setPhase('result');
  }

  return (
    <GameShell
      title="Odd Ear Out"
      phase={phase}
      progress={{ current: index + (settledNow ? 1 : 0), total }}
      intro={{
        signalLabel: pick.signal === 'any' ? 'Your words' : SIGNAL_LABELS[pick.signal],
        whyLine: describeRound(pick, ODD_EAR_COPY),
        roundDescription: `${total} rounds of four native clips of same-length words — three share an accent shape, one doesn't. About 3 minutes. Each round starts worth ${ODD_EAR_TRIAL_POINTS} points and loses one per wrong pick. Wear headphones if you can.`,
        onStart: () => setPhase('play'),
      }}
    >
      {phase === 'play' ? (
        <>
          <TrialView key={trial.id} trial={trial} onSolved={handleSolved} />
          {settledNow ? (
            <div>
              <button type="button" className="primary" onClick={next}>
                {index + 1 < total ? 'Next round' : 'See results'}
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
          {results.map((r) => {
            const odd = r.trial.clips[r.trial.oddIndex]!;
            return (
              <div key={r.ref} className="stack" style={{ gap: '0.2rem' }}>
                <div>
                  {r.correct ? '✓ ' : ''}
                  <span className="jp">
                    {r.trial.clips
                      .filter((_, i) => i !== r.trial.oddIndex)
                      .map((c) => c.expression)
                      .join('・')}
                  </span>{' '}
                  <span className="muted">
                    — odd one: <span className="jp">{odd.expression}</span> · {r.points} /{' '}
                    {ODD_EAR_TRIAL_POINTS}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  The three alike: {shapeLabel(r.trial.contrast.majorityShape)}.
                  <br />
                  The odd one: {shapeLabel(r.trial.contrast.oddShape)}.
                </div>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  Why this contrast: {r.why}
                </div>
              </div>
            );
          })}
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
