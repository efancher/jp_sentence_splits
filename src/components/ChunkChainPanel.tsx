import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';

import { getDb, logChunkChainRung, logChunkChainSummary } from '../db/repository';
import { cuttableWords, planChunkChain, rungsFromCutTimes, type ChainRung } from '../lib/chunkChain';
import {
  COLD_PASS_SHARE,
  advanceFromFirstRung,
  highestGotItRung,
  rateChainRung,
  startChainSession,
  type ChainSession,
} from '../lib/chunkChainSession';
import { createId } from '../lib/ids';
import { PHRASE_SHADOW_OUTCOMES, type PhraseShadowOutcome } from '../lib/phraseShadow';

/**
 * Chunk chain shadowing (docs/ROADMAP.md, "Chunk chain"): shadow the last phrase, then the last two,
 * and so on up to the whole sentence, so every rung ends on the sentence's real final intonation.
 * Offered in the Shadow pane only when the stored alignment can place at least three duration-sized
 * rungs; otherwise it renders nothing and the whole sentence is shadowed as usual (never a gate).
 * The pane's own loop and record controls do the shadowing: this panel only points them at the
 * current rung (`onRange`), asks the learner to rate it, and logs. Ratings are the learner's own call.
 */
export function ChunkChainPanel({
  bookId,
  sentenceId,
  sentenceAudioId,
  visitId,
  onRange,
  onActiveChange,
  random = Math.random,
}: {
  bookId: string;
  sentenceId: string;
  sentenceAudioId: string;
  visitId?: string;
  /** Points the pane's loop and target at a rung, or clears them (null) when the chain ends or is left. */
  onRange: (range: { startMs: number; endMs: number } | null) => void;
  /** Lets the pane hide its single-phrase rating while a chain is running. */
  onActiveChange?: (active: boolean) => void;
  /** Decides which runs open with a cold whole-sentence try; injectable for tests. */
  random?: () => number;
}) {
  const plan = useLiveQuery(async () => {
    const db = getDb();
    const [alignment, sentence] = await Promise.all([db.referenceAlignments.get(sentenceAudioId), db.sentences.get(sentenceId)]);
    if (!alignment || !sentence) return null;
    return {
      plan: planChunkChain(sentence, alignment.result.words),
      words: alignment.result.words,
      japanese: sentence.japanese,
    };
  }, [sentenceAudioId, sentenceId]);

  // Hand-placed steps replace the suggested ones until reset; they are per visit, not stored.
  const [custom, setCustom] = useState<ChainRung[] | null>(null);
  const [adjusting, setAdjusting] = useState<number[] | null>(null);
  const suggested = plan && !plan.plan.rejection ? plan.plan.rungs : null;
  const rungs = custom ?? suggested;
  const [session, setSession] = useState<ChainSession | null>(null);
  const [cold, setCold] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chainVisit = useRef<string>('');
  const summaryLogged = useRef(false);

  const active = session !== null && !session.done;
  useEffect(() => {
    onActiveChange?.(session !== null);
  }, [session, onActiveChange]);

  // The loop follows the rung being shadowed.
  const rung = rungs && session ? (cold ? rungs[rungs.length - 1] : rungs[session.rungIndex]) : null;
  useEffect(() => {
    if (rung && active) onRange({ startMs: rung.startMs, endMs: rung.endMs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rung?.startMs, rung?.endMs, active, cold]);

  // A different sentence starts over.
  useEffect(() => {
    setSession(null);
    setError(null);
    setCustom(null);
    setAdjusting(null);
  }, [sentenceAudioId, sentenceId]);

  const rungSummary = useMemo(
    () => (rungs ? `${rungs.length} steps, ${Math.round((rungs[0]!.endMs - rungs[0]!.startMs) / 100) / 10}s up to the whole sentence` : ''),
    [rungs],
  );

  if (!rungs) return null;

  function start() {
    chainVisit.current = visitId ?? createId('chain_visit');
    summaryLogged.current = false;
    setError(null);
    setCold(random() < COLD_PASS_SHARE);
    setSession(startChainSession(rungs!.length));
  }

  function leave() {
    setSession(null);
    onRange(null);
  }

  async function rateCold(outcome: PhraseShadowOutcome) {
    if (!rungs || busy) return;
    const whole = rungs[rungs.length - 1]!;
    setBusy(true);
    setError(null);
    try {
      await logChunkChainRung({
        bookId,
        sentenceId,
        rungIndex: 'cold',
        range: { startMs: whole.startMs, endMs: whole.endMs },
        text: whole.text,
        outcome,
        visitId: chainVisit.current,
      });
      setCold(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save that rating.');
    } finally {
      setBusy(false);
    }
  }

  async function rate(outcome: PhraseShadowOutcome) {
    if (!session || !rungs || busy) return;
    const current = rungs[session.rungIndex]!;
    setBusy(true);
    setError(null);
    try {
      await logChunkChainRung({
        bookId,
        sentenceId,
        rungIndex: session.rungIndex,
        range: { startMs: current.startMs, endMs: current.endMs },
        text: current.text,
        outcome,
        visitId: chainVisit.current,
      });
      const next = rateChainRung(session, outcome);
      if (next.done && !summaryLogged.current) {
        summaryLogged.current = true;
        const best = highestGotItRung(next);
        const top = best === null ? null : rungs[best]!;
        if (top) {
          await logChunkChainSummary({
            bookId,
            sentenceId,
            range: { startMs: top.startMs, endMs: top.endMs },
            text: top.text,
            visitId: chainVisit.current,
          });
        }
        onRange(null);
      }
      setSession(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save that rating.');
    } finally {
      setBusy(false);
    }
  }

  if (!session && adjusting && plan) {
    const words = cuttableWords(plan.words);
    const toggle = (startMs: number) =>
      setAdjusting((cuts) => (cuts ? (cuts.includes(startMs) ? cuts.filter((cut) => cut !== startMs) : [...cuts, startMs]) : cuts));
    return (
      <div className="stack" role="group" aria-label="Adjust chain steps" style={{ gap: '0.25rem' }}>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Tap a word to start (or stop) a step there. Each step runs from its marked word to the end of the sentence.
        </p>
        <p lang="ja" style={{ margin: 0, lineHeight: 2 }}>
          {words.map((word, index) => {
            const startMs = word.start * 1000;
            const marked = adjusting.includes(startMs);
            return (
              <button
                key={`${index}-${word.start}`}
                type="button"
                disabled={index === 0}
                aria-pressed={marked}
                aria-label={index === 0 ? `${word.text} (sentence start)` : `Step starts at ${word.text}`}
                onClick={() => toggle(startMs)}
                style={{ padding: '0 0.2rem', marginRight: '0.1rem', fontWeight: marked ? 700 : 400, borderLeft: marked ? '3px solid currentColor' : '3px solid transparent' }}
              >
                {word.text}
              </button>
            );
          })}
        </p>
        <div className="row">
          <button
            type="button"
            onClick={() => {
              const built = rungsFromCutTimes(plan.japanese, plan.words, adjusting);
              if (!built) {
                setError('Pick at least one word, not too near the start or end, to begin a step.');
                return;
              }
              setError(null);
              setCustom(built);
              setAdjusting(null);
            }}
          >
            Use these steps
          </button>
          <button type="button" onClick={() => { setError(null); setAdjusting(null); }}>Cancel</button>
          {custom ? <button type="button" onClick={() => { setCustom(null); setAdjusting(null); }}>Back to suggested</button> : null}
        </div>
        {error ? <p className="muted" style={{ margin: 0 }}>{error}</p> : null}
      </div>
    );
  }

  if (!session) {
    return (
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={start}>Chunk chain</button>
        {plan ? (
          <button type="button" onClick={() => setAdjusting(rungs.filter((entry) => !entry.whole).map((entry) => entry.startMs))}>
            Adjust steps
          </button>
        ) : null}
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          Build the sentence from its end, one phrase at a time ({rungSummary}).
        </span>
      </div>
    );
  }

  if (session.done) {
    const best = highestGotItRung(session);
    return (
      <div className="stack" role="status" style={{ gap: '0.25rem' }}>
        <p style={{ margin: 0 }}>
          {best === null
            ? 'Chain finished without a Got it. Try again after listening a few more times, or shadow the sentence as usual.'
            : best === rungs.length - 1
              ? 'You got the whole sentence.'
              : `You got it up to “${rungs[best]!.text}”.`}
        </p>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Logged as your own ratings: it does not grade any card.
        </p>
        <div className="row">
          <button type="button" onClick={start}>Run it again</button>
          <button type="button" onClick={leave}>Close</button>
        </div>
      </div>
    );
  }

  if (cold) {
    return (
      <div className="stack" role="group" aria-label="Cold try" style={{ gap: '0.25rem' }}>
        <p style={{ margin: 0 }}>
          <span className="muted">Before the chain, try the whole sentence cold: </span>
          <strong lang="ja">{rungs[rungs.length - 1]!.text}</strong>
        </p>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Shadow it once with no build-up, then say how it went. This only lets you compare against the end of the chain.
        </p>
        <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          {PHRASE_SHADOW_OUTCOMES.map((entry) => (
            <button key={entry.outcome} type="button" disabled={busy} onClick={() => void rateCold(entry.outcome)}>
              {entry.label}
            </button>
          ))}
          <button type="button" onClick={() => setCold(false)}>Skip</button>
        </div>
        {error ? <p className="muted" style={{ margin: 0 }}>{error}</p> : null}
      </div>
    );
  }

  const current = rungs[session.rungIndex]!;
  const first = session.rungIndex === 0;
  return (
    <div className="stack" role="group" aria-label="Chunk chain" style={{ gap: '0.25rem' }}>
      <p style={{ margin: 0 }}>
        <span className="muted">
          Step {session.rungIndex + 1} of {rungs.length}
          {current.whole ? ' (the whole sentence)' : ''}:{' '}
        </span>
        <strong lang="ja">{current.text}</strong>
      </p>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        {first
          ? 'Loop it and say it back until it feels easy, then tap Next. This first step is not rated.'
          : 'Loop it and shadow it, then say how it went.'}
      </p>
      {first ? (
        <div className="row">
          <button type="button" onClick={() => setSession(advanceFromFirstRung(session))}>Next</button>
          <button type="button" onClick={leave}>Stop chain</button>
        </div>
      ) : (
        <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted">How did this step go?</span>
          {PHRASE_SHADOW_OUTCOMES.map((entry) => (
            <button key={entry.outcome} type="button" disabled={busy} onClick={() => void rate(entry.outcome)}>
              {entry.label}
            </button>
          ))}
          <button type="button" onClick={leave}>Stop chain</button>
        </div>
      )}
      {error ? <p className="muted" style={{ margin: 0 }}>{error}</p> : null}
    </div>
  );
}
