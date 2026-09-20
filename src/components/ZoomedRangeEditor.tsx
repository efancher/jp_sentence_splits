import { useEffect, useMemo, useRef, useState } from 'react';

import { clampEnd, clampStart } from '../lib/boundaryEditor';
import { decodeWithRepair } from '../lib/decodeWithRepair';
import { RangePlayer } from '../lib/rangePlayer';
import type { TimeRangeMs } from '../lib/recording';

import { BoundaryEdgeEditor } from './BoundaryEdgeEditor';

/**
 * Hand-adjusts the span a word card loops (`SentenceVocabulary.audioStartMs/EndMs`),
 * replacing the old whole-sentence drag editor with the zoomed edge views built
 * for the labelling screen: ±400 ms of waveform around each edge (10 ms ≈ 7 px),
 * ±1 / ±10 / ±100 ms nudges, "hear before / after" for each edge, and a play
 * toggle for the span. Nothing is written until Save, so a slip on a phone can be
 * cancelled. The span is what the card *loops*: for pitch cards keep the word's
 * ending or following particle inside it — that is what shows whether the pitch
 * stays high or falls. (The labelling screen, by contrast, marks the strict word.)
 */
export function ZoomedRangeEditor({
  blob,
  audioId,
  value,
  hasOverride,
  onSave,
  onReset,
  onCancel,
}: {
  blob: Blob;
  audioId: string;
  /** Where the handles start: the saved override, else the automatic span. */
  value: TimeRangeMs;
  /** True when `value` is a saved override (shows "Reset to automatic"). */
  hasOverride: boolean;
  onSave: (range: TimeRangeMs) => void;
  onReset: () => void;
  onCancel: () => void;
}) {
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edges, setEdges] = useState<TimeRangeMs>(value);
  const [playing, setPlaying] = useState(false);
  const [withContext, setWithContext] = useState(false);
  const playerRef = useRef(new RangePlayer());

  useEffect(() => {
    const player = playerRef.current;
    return () => player.dispose();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { repairSentenceAudio } = await import('../sync/audioSync');
        const decoded = await decodeWithRepair(blob, audioId, repairSentenceAudio);
        if (!cancelled) setBuffer(decoded);
      } catch (err) {
        if (!cancelled) setError(`Couldn’t decode this recording on this device (${err instanceof Error ? err.message : String(err)}).`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob, audioId]);

  const durationMs = buffer ? buffer.duration * 1000 : 0;
  const moved = Math.abs(edges.startMs - value.startMs) >= 1 || Math.abs(edges.endMs - value.endMs) >= 1;
  const rounded = useMemo(() => ({ startMs: Math.round(edges.startMs), endMs: Math.round(edges.endMs) }), [edges]);

  const play = (range: TimeRangeMs, loop: boolean) => {
    if (!buffer) return;
    setPlaying(loop);
    void playerRef.current.play(buffer, range, { onEnded: () => setPlaying(false) });
  };

  const audition = (kind: 'start' | 'end', which: 'outside' | 'inside') => {
    const edge = kind === 'start' ? edges.startMs : edges.endMs;
    const before = { startMs: Math.max(0, edge - 300), endMs: edge };
    const after = { startMs: edge, endMs: Math.min(durationMs, edge + 300) };
    // At a start edge the word is after it; at an end edge, before it.
    const ranges = kind === 'start' ? { outside: before, inside: after } : { outside: after, inside: before };
    play(ranges[which], false);
  };

  return (
    <div className="stack panel" role="group" aria-label="Word audio range editor" style={{ gap: '0.6rem' }}>
      <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
        Set the span this card loops. For pitch cards keep the word’s ending or following particle inside it.
      </p>
      {error ? <p className="muted" style={{ margin: 0 }}>{error}</p> : null}
      {!buffer && !error ? <p className="muted" style={{ margin: 0 }}>Loading audio…</p> : null}
      {buffer && (
        <>
          <BoundaryEdgeEditor
            kind="start"
            buffer={buffer}
            edgeMs={edges.startMs}
            otherEdgeMs={edges.endMs}
            onChange={(ms) => setEdges((e) => ({ ...e, startMs: clampStart(ms, e.endMs) }))}
            onAudition={(which) => audition('start', which)}
          />
          <BoundaryEdgeEditor
            kind="end"
            buffer={buffer}
            edgeMs={edges.endMs}
            otherEdgeMs={edges.startMs}
            onChange={(ms) => setEdges((e) => ({ ...e, endMs: clampEnd(ms, e.startMs, durationMs) }))}
            onAudition={(which) => audition('end', which)}
          />
          <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                if (playing) {
                  playerRef.current.stop();
                  setPlaying(false);
                  return;
                }
                const pad = withContext ? 500 : 0;
                play({ startMs: Math.max(0, edges.startMs - pad), endMs: Math.min(durationMs, edges.endMs + pad) }, true);
              }}
            >
              {playing ? '■ Stop' : '▶ Play this span'}
            </button>
            <label className="row" style={{ gap: '0.3rem', alignItems: 'center' }}>
              <input type="checkbox" checked={withContext} onChange={(e) => setWithContext(e.target.checked)} />
              with 0.5 s of context
            </label>
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              {rounded.startMs}–{rounded.endMs} ms ({rounded.endMs - rounded.startMs} ms)
            </span>
          </div>
        </>
      )}
      <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        <button type="button" className="primary" disabled={!buffer || !moved} onClick={() => onSave(rounded)}>
          Save
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        {hasOverride ? (
          <button type="button" className="secondary" onClick={onReset}>
            Reset to automatic
          </button>
        ) : null}
      </div>
    </div>
  );
}
