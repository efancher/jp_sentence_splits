import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import {
  getRecentGameDifficulty,
  getRemixData,
  logGameRound,
  type RemixCandidate,
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
  buildRemixPuzzle,
  describeRemixPick,
  isCorrectNoun,
  maxRemixPoints,
  POINTS_PER_SWAP,
  REMIX_COPY,
  REMIX_GAME_ID,
  REMIX_ROUND_SIZE,
  remixedSentence,
  slotLabel,
  swapPoints,
  type RemixNoun,
  type RemixPuzzle,
  type RemixSwapScore,
} from '../../lib/remix';
import { NativeAudioButton } from '../NativeAudioButton';
import { SpeakButton } from '../SpeakButton';
import { GameShell, type GamePhase } from './GameShell';

export { REMIX_COPY, REMIX_GAME_ID };

interface Entry {
  candidate: RemixCandidate;
  puzzle: RemixPuzzle;
}

interface Settled extends GameRoundItem {
  entry: Entry;
  swaps: RemixSwapScore[];
  firstWrong: Map<number, string>;
  why: string;
}

interface Round {
  pick: PickResult<RemixCandidate>;
  entries: Entry[];
}

interface SwapState {
  input: string;
  locked: boolean;
  wrong: number;
  revealed: boolean;
  firstWrong?: string;
}

const freshStage = (puzzle: RemixPuzzle, stage: 0 | 1): SwapState[] =>
  puzzle.stages[stage].swaps.map(() => ({ input: '', locked: false, wrong: 0, revealed: false }));

const STAGE_TITLES = ['Swap one slot', 'Swap two slots'] as const;

function RemixCard({
  entry,
  onComplete,
}: {
  entry: Entry;
  onComplete: (swaps: RemixSwapScore[], firstWrong: Map<number, string>) => void;
}) {
  const { puzzle, candidate } = entry;
  const { skeleton } = puzzle;
  // 0 = swap one, 1 = swap two, 2 = finished
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const [swaps, setSwaps] = useState<SwapState[]>(() => freshStage(puzzle, 0));
  const [flash, setFlash] = useState(false);
  const earlier = useRef<RemixSwapScore[]>([]);
  const firstWrong = useRef(new Map<number, string>());

  const stageSwaps = stage !== 2 ? puzzle.stages[stage].swaps : [];
  const stageSettled = stage !== 2 && swaps.every((swap) => swap.locked);

  // Replacements shown in the sentence so far: the current stage's settled swaps.
  const replacements = new Map<number, string>();
  stageSwaps.forEach((swap, i) => {
    if (swaps[i]?.locked) replacements.set(swap.slot, swap.noun.expression);
  });
  const slotSwapIndex = (slot: number) => stageSwaps.findIndex((swap) => swap.slot === slot);
  const newSentence = remixedSentence(candidate.sentence, skeleton, replacements);

  function setSwap(i: number, patch: Partial<SwapState>) {
    setSwaps((prev) => prev.map((swap, j) => (j === i ? { ...swap, ...patch } : swap)));
  }

  // One Check for the whole stage: each filled, unlocked blank is judged at once.
  function check(event: FormEvent) {
    event.preventDefault();
    if (stage === 2 || stageSettled) return;
    let anyWrong = false;
    const next = swaps.map((swap, i) => {
      const target = stageSwaps[i]!;
      if (swap.locked || !swap.input.trim()) return swap;
      if (isCorrectNoun(swap.input, target.noun)) return { ...swap, locked: true };
      anyWrong = true;
      if (swap.wrong === 0) firstWrong.current.set(target.slot, swap.input.trim());
      return { ...swap, wrong: swap.wrong + 1 };
    });
    setSwaps(next);
    setFlash(anyWrong);
  }

  function reveal() {
    setSwaps((prev) =>
      prev.map((swap, i) =>
        swap.locked ? swap : { ...swap, locked: true, revealed: true, input: stageSwaps[i]!.noun.expression },
      ),
    );
    setFlash(false);
  }

  function advance() {
    if (stage === 2) return;
    const scored = swaps.map((swap, i) => ({
      slot: stageSwaps[i]!.slot,
      wrong: swap.wrong,
      revealed: swap.revealed,
      points: swapPoints(swap.wrong, swap.revealed),
    }));
    earlier.current = [...earlier.current, ...scored];
    setFlash(false);
    if (stage === 0) {
      setStage(1);
      setSwaps(freshStage(puzzle, 1));
    } else {
      setStage(2);
      onComplete(earlier.current, firstWrong.current);
    }
  }

  const liveWrong = swaps.reduce((sum, swap) => sum + swap.wrong, 0);

  return (
    <div className="stack">
      <div className="row" style={{ alignItems: 'center' }}>
        <NativeAudioButton audio={candidate.audio} displayLabel="Hear the sentence" />
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          A real sentence from your books. Replay as often as you like.
        </span>
      </div>

      <div className="stack" style={{ gap: '0.35rem' }} aria-label="Sentence skeleton">
        <div className="row jp jp-lg" style={{ flexWrap: 'wrap', gap: '0.4rem', alignItems: 'flex-start' }}>
          {skeleton.slots.map((slot, index) => {
            const i = slotSwapIndex(index);
            const swapped = i >= 0 && swaps[i]?.locked;
            const targeted = i >= 0 && stage !== 2;
            return (
              <span key={index} className="stack" style={{ gap: '0.1rem' }}>
                <span>
                  <span
                    style={{
                      padding: '0.1rem 0.4rem',
                      borderRadius: 'var(--radius)',
                      border: `2px ${targeted && !swapped ? 'dashed' : 'solid'} ${
                        swapped ? 'var(--success)' : targeted ? 'var(--accent)' : 'var(--border)'
                      }`,
                      color: swapped ? 'var(--success)' : undefined,
                      textDecoration: targeted && !swapped ? 'line-through' : undefined,
                    }}
                  >
                    {swapped ? stageSwaps[i]!.noun.expression : slot.noun}
                  </span>
                  {slot.particle}
                </span>
                <span className="muted" style={{ fontSize: '0.7rem', fontFamily: 'inherit' }}>
                  {slot.gloss ? `${slot.gloss} — ` : ''}
                  {slot.hint}
                </span>
              </span>
            );
          })}
          <span className="stack" style={{ gap: '0.1rem' }}>
            <span>{skeleton.verbText}</span>
            <span className="muted" style={{ fontSize: '0.7rem', fontFamily: 'inherit' }}>
              stays the same
            </span>
          </span>
        </div>
      </div>

      {stage !== 2 ? (
        <form className="stack" onSubmit={check} style={{ gap: '0.5rem' }}>
          <strong>
            {STAGE_TITLES[stage]} <span className="muted">({stage + 1} of 2)</span>
          </strong>
          {stageSwaps.map((swap, i) => {
            const slot = skeleton.slots[swap.slot]!;
            const state = swaps[i]!;
            return (
              <label key={swap.slot} className="stack" style={{ gap: '0.15rem' }}>
                <span>
                  Replace <span className="jp">{slotLabel(skeleton, swap.slot)}</span> ({slot.hint}) with{' '}
                  <strong>“{swap.noun.gloss}”</strong> — type it in Japanese
                </span>
                <input
                  className="jp"
                  lang="ja"
                  value={state.input}
                  disabled={state.locked}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(event) => setSwap(i, { input: event.target.value })}
                  aria-invalid={flash && !state.locked && state.wrong > 0}
                />
                {state.locked ? (
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    {state.revealed
                      ? `Shown: ${swap.noun.expression}（${swap.noun.reading}）`
                      : `✓ ${swap.noun.expression}（${swap.noun.reading}）`}
                  </span>
                ) : state.wrong > 0 ? (
                  <span style={{ fontSize: '0.8rem', color: 'var(--danger)' }}>
                    ✗ Not “{state.input.trim()}” — kanji or kana both work.
                  </span>
                ) : null}
              </label>
            );
          })}
          {stageSettled ? (
            <div className="stack" style={{ gap: '0.4rem' }} role="status">
              <div className="jp jp-lg">{newSentence}</div>
              <div className="row" style={{ alignItems: 'center' }}>
                <SpeakButton
                  text={newSentence}
                  itemId={`remix-${candidate.id}-${stage}`}
                  label="Hear your remixed sentence read aloud"
                  displayLabel="Hear it, then say it"
                />
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  Grammatical, though the meaning may be silly — that’s fine.
                </span>
              </div>
              <div>
                <button type="button" className="primary" onClick={advance}>
                  {stage === 0 ? 'Next: swap two slots' : 'Finish this sentence'}
                </button>
              </div>
            </div>
          ) : (
            <div className="row" style={{ alignItems: 'center' }}>
              <button type="submit" className="primary" disabled={swaps.every((s) => s.locked || !s.input.trim())}>
                Check
              </button>
              <button type="button" className="ghost" onClick={reveal}>
                Show the answer{swaps.length > 1 ? 's' : ''} (0 points)
              </button>
              <span className="muted" style={{ fontSize: '0.8rem' }} role="status">
                {liveWrong > 0 ? `${liveWrong} miss${liveWrong === 1 ? '' : 'es'} so far — ` : ''}
                {POINTS_PER_SWAP} points per swap, one less per miss.
              </span>
            </div>
          )}
        </form>
      ) : (
        <div className="stack" style={{ gap: '0.3rem' }} role="status">
          <div className="jp jp-lg">{remixedSentence(candidate.sentence, skeleton, finalReplacements(puzzle))}</div>
          <div className="muted">Original: {candidate.sentence.translation}</div>
        </div>
      )}
    </div>
  );
}

/** The second (two-swap) stage's replacements: the fullest remix of the sentence. */
function finalReplacements(puzzle: RemixPuzzle): Map<number, string> {
  return new Map(puzzle.stages[1].swaps.map((swap) => [swap.slot, swap.noun.expression]));
}

export function RemixGame({ signal }: { signal: GameSignal }) {
  const [data, setData] = useState<{ candidates: RemixCandidate[]; pool: RemixNoun[] } | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [phase, setPhase] = useState<GamePhase>('intro');
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [results, setResults] = useState<Settled[]>([]);
  const shownAt = useRef(Date.now());
  const logged = useRef(false);
  const started = useRef(false);
  const [difficulty, setDifficulty] = useState<DifficultyTier>('standard');

  // Loaded once per visit (not live) so a Dexie refresh can't reshuffle mid-round.
  useEffect(() => {
    let cancelled = false;
    void getRemixData().then((loaded) => {
      if (!cancelled) setData(loaded);
    });
    void getRecentGameDifficulty(REMIX_GAME_ID).then((tier) => {
      if (!cancelled) setDifficulty(tier);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const newRound = useCallback(
    (from: { candidates: RemixCandidate[]; pool: RemixNoun[] }) => {
      const seed = `${Date.now()}:${Math.random()}`;
      const pick = pickItems(from.candidates, { signal, n: REMIX_ROUND_SIZE, seed, difficulty });
      const entries = pick.items.flatMap((candidate) => {
        const puzzle = buildRemixPuzzle(candidate.sentence, from.pool, `${seed}:${candidate.id}`);
        return puzzle ? [{ candidate, puzzle }] : [];
      });
      setRound({ pick, entries });
      setPhase('intro');
      setIndex(0);
      setDone(false);
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

  const { pick, entries } = round;
  if (entries.length < REMIX_ROUND_SIZE) {
    return (
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Remix</h2>
        <p className="muted" style={{ margin: 0 }}>
          Needs at least {REMIX_ROUND_SIZE} sentences you&apos;ve met, with native audio, a verb or adjective ending
          and two or more noun + particle slots, plus enough nouns from your sentences to swap in — you have{' '}
          {data.candidates.length} sentence{data.candidates.length === 1 ? '' : 's'} and {data.pool.length}{' '}
          usable nouns so far.
        </p>
        <Link to="/play">Back to games</Link>
      </section>
    );
  }

  const entry = entries[index]!;
  const total = entries.length;
  const maxPoints = entries.reduce((sum, e) => sum + maxRemixPoints(e.puzzle), 0);
  const totalPoints = results.reduce((sum, r) => sum + r.points, 0);

  function handleComplete(swaps: RemixSwapScore[], firstWrong: Map<number, string>) {
    const wrongGuesses = swaps.reduce((sum, swap) => sum + swap.wrong, 0);
    const reveals = swaps.filter((swap) => swap.revealed).length;
    setDone(true);
    setResults((prev) => [
      ...prev,
      {
        ref: entry.candidate.id,
        correct: wrongGuesses === 0 && reveals === 0,
        cluesUsed: reveals,
        wrongGuesses,
        points: swaps.reduce((sum, swap) => sum + swap.points, 0),
        ms: Date.now() - shownAt.current,
        parts: swaps.map((swap) => ({
          key: entry.puzzle.skeleton.slots[swap.slot]!.particle,
          correct: swap.wrong === 0 && !swap.revealed,
          ...(firstWrong.has(swap.slot) ? { note: firstWrong.get(swap.slot) } : {}),
        })),
        entry,
        swaps,
        firstWrong,
        why: describeRemixPick(pick.signal, entry.candidate.weakWords),
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
        gameId: REMIX_GAME_ID,
        signal: pick.signal,
        poolSize: pick.poolSize,
        items: results.map(({ entry: _entry, swaps: _swaps, firstWrong: _fw, why: _why, ...item }) => item),
      });
    }
    setPhase('result');
  }

  return (
    <GameShell
      title="Remix"
      phase={phase}
      progress={{ current: index + (done ? 1 : 0), total }}
      intro={{
        signalLabel: pick.signal === 'any' ? 'Your sentences' : SIGNAL_LABELS[pick.signal],
        whyLine: describeRound(pick, REMIX_COPY),
        roundDescription: `${total} real sentences, about 4 minutes. Hear one, see its skeleton, then swap one slot for a noun you know — given in English, typed in Japanese — and then swap two. The particles and verb stay as spoken. Each swap is worth ${POINTS_PER_SWAP} points, one less per miss.`,
        onStart: () => {
          shownAt.current = Date.now();
          setPhase('play');
        },
      }}
    >
      {phase === 'play' ? (
        <>
          <RemixCard key={entry.candidate.id} entry={entry} onComplete={handleComplete} />
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
          <div>
            <strong>
              {totalPoints} / {maxPoints} points
            </strong>{' '}
            <span className="muted">
              — {results.filter((r) => r.correct).length} of {total} sentences with no misses or reveals
            </span>
          </div>
          {results.map((r) => {
            const { skeleton } = r.entry.puzzle;
            return (
              <div key={r.ref} className="stack" style={{ gap: '0.25rem' }}>
                <div className="jp jp-lg">
                  {r.correct ? '✓ ' : ''}
                  {r.entry.candidate.sentence.japanese}{' '}
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    {r.points} / {maxRemixPoints(r.entry.puzzle)}
                  </span>
                </div>
                <div className="muted">{r.entry.candidate.sentence.translation}</div>
                {r.entry.puzzle.stages.map((stage, s) => (
                  <div key={s} className="jp">
                    {remixedSentence(
                      r.entry.candidate.sentence,
                      skeleton,
                      new Map(stage.swaps.map((swap) => [swap.slot, swap.noun.expression])),
                    )}{' '}
                    <span className="muted" style={{ fontSize: '0.8rem', fontFamily: 'inherit' }}>
                      ({stage.swaps.map((swap) => `${swap.noun.gloss} = ${swap.noun.expression}`).join(', ')})
                    </span>
                  </div>
                ))}
                {[...r.firstWrong].map(([slot, typed]) => (
                  <div key={slot} className="muted" style={{ fontSize: '0.85rem' }}>
                    For the {skeleton.slots[slot]!.particle} slot you first typed {typed}.
                  </div>
                ))}
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  Why this sentence: {r.why}
                </div>
                <div>
                  <NativeAudioButton audio={r.entry.candidate.audio} displayLabel="Replay" />
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
