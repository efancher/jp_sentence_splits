import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { getThenAndNowData, type ThenAndNowClipData } from '../../db/repository';
import type { GameSignal } from '../../domain/types';
import { useSentenceAudioBlob } from '../../hooks/useSentenceAudioBlob';
import { decodeWithRepair } from '../../lib/decodeWithRepair';
import { DuckedRangePlayer } from '../../lib/duckedRangePlayer';
import { seededShuffle } from '../../lib/seededShuffle';
import {
  buildThenAndNowRound,
  describeThenAndNowClip,
  THEN_AND_NOW_MIN_AGE_DAYS,
  THEN_AND_NOW_ROUND_SIZE,
} from '../../lib/thenAndNow';
import { GameShell, type GamePhase } from './GameShell';

type Data = ThenAndNowClipData[];

/**
 * One clip: decodes its audio once, offers "Then" (the then-unknown words
 * ducked quiet) and "Now" (full volume) as separate taps — never both at
 * once, and never from a timer, per the iOS audio-gesture rule every other
 * game already follows.
 */
function ClipView({ clip, onDone }: { clip: ThenAndNowClipData; onDone: () => void }) {
  const blob = useSentenceAudioBlob(clip.audio);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<'then' | 'now' | null>(null);
  const [playedThen, setPlayedThen] = useState(false);
  const [playedNow, setPlayedNow] = useState(false);
  const playerRef = useRef(new DuckedRangePlayer());

  useEffect(() => {
    const player = playerRef.current;
    return () => player.dispose();
  }, []);

  useEffect(() => {
    if (!blob) return;
    let cancelled = false;
    void (async () => {
      try {
        const { repairSentenceAudio } = await import('../../sync/audioSync');
        const decoded = await decodeWithRepair(blob, clip.audio.id, repairSentenceAudio);
        if (!cancelled) setBuffer(decoded);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob, clip.audio.id]);

  function playThen() {
    if (!buffer || playing) return;
    setPlaying('then');
    setPlayedThen(true);
    void playerRef.current.play(
      buffer,
      { startMs: 0, endMs: buffer.duration * 1000 },
      clip.thenUnknownWords,
      { onEnded: () => setPlaying(null) },
    );
  }

  function playNow() {
    if (!buffer || playing) return;
    setPlaying('now');
    setPlayedNow(true);
    void playerRef.current.play(buffer, { startMs: 0, endMs: buffer.duration * 1000 }, [], {
      onEnded: () => setPlaying(null),
    });
  }

  return (
    <div className="stack">
      <div className="jp jp-lg">{clip.japanese}</div>
      <div className="muted">{clip.translation}</div>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        {describeThenAndNowClip(clip)}
      </p>
      {error ? <p className="muted">Couldn’t decode this clip on this device ({error}).</p> : null}
      {!buffer && !error ? <p className="muted">Loading audio…</p> : null}
      {buffer ? (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`speak-button${playing === 'then' ? ' speaking' : ''}`}
            onClick={playThen}
            disabled={!!playing}
          >
            ▶ Then ({clip.thenUnknownWords.length} word{clip.thenUnknownWords.length === 1 ? '' : 's'} quiet)
          </button>
          <button
            type="button"
            className={`speak-button${playing === 'now' ? ' speaking' : ''}`}
            onClick={playNow}
            disabled={!!playing}
          >
            ▶ Now (full clip)
          </button>
        </div>
      ) : null}
      <div>
        <button type="button" className="primary" disabled={!playedThen || !playedNow} onClick={onDone}>
          Next
        </button>
      </div>
    </div>
  );
}

/**
 * Then & Now (docs/ROADMAP.md "Short games", 2026-09-26 brainstorm): a
 * purely reflective listen, not a scored round (2026-09-27 decision — there
 * is no right/wrong here to grade). Replays a sentence read a while ago with
 * the words that were still unknown back then ducked quiet, then again at
 * full volume, so the difference is audible rather than just stated. Writes
 * nothing to `gameRounds` — unlike every other `/play` activity, this one
 * has no signal, no score, and no "why this round" pool ranking; `signal` is
 * accepted (the shared `GameDef.Component` shape) but unused, same as
 * Keystone's signal-less round.
 */
export function ThenAndNowGame({ signal: _signal }: { signal: GameSignal }) {
  const [data, setData] = useState<Data | null>(null);
  const [round, setRound] = useState<ThenAndNowClipData[] | null>(null);
  const [phase, setPhase] = useState<GamePhase>('intro');
  const [index, setIndex] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getThenAndNowData().then((rows) => {
      if (!cancelled) setData(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const newRound = useCallback((from: Data) => {
    const seed = `${Date.now()}:${Math.random()}`;
    const shuffled = seededShuffle(from, (clip) => clip.sentenceId, seed);
    setRound(buildThenAndNowRound(shuffled, THEN_AND_NOW_ROUND_SIZE));
    setPhase('intro');
    setIndex(0);
  }, []);

  useEffect(() => {
    if (data && !started.current) {
      started.current = true;
      newRound(data);
    }
  }, [data, newRound]);

  if (!data || !round) return <p className="muted">Loading…</p>;

  if (round.length === 0) {
    return (
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Then &amp; Now</h2>
        <p className="muted" style={{ margin: 0 }}>
          Needs a sentence you reviewed at least {THEN_AND_NOW_MIN_AGE_DAYS} days ago whose linked
          vocabulary has grown since — confirming more words while you read will fill this in.
        </p>
        <Link to="/play">Back to games</Link>
      </section>
    );
  }

  const total = round.length;
  const clip = round[index]!;

  function next() {
    if (index + 1 < total) {
      setIndex(index + 1);
      return;
    }
    setPhase('result');
  }

  return (
    <GameShell
      title="Then & Now"
      phase={phase}
      progress={{ current: index, total }}
      intro={{
        signalLabel: 'Your reading history',
        whyLine:
          "A few sentences you read a while ago, replayed with the words you didn't know back then turned down quiet — then again at full volume.",
        roundDescription: `${total} clip${total === 1 ? '' : 's'}, purely to notice the difference. Nothing here is scored or changes your review schedule.`,
        onStart: () => setPhase('play'),
      }}
    >
      {phase === 'play' ? <ClipView key={clip.sentenceId} clip={clip} onDone={next} /> : null}

      {phase === 'result' ? (
        <div className="stack">
          <p className="muted">That's the round — nothing here was graded.</p>
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
