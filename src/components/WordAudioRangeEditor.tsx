import { useEffect, useMemo, useRef, useState } from 'react';

import type { TimeRangeMs } from '../lib/recording';
import {
  canonicalizeAudioBuffer,
  computePeaks,
  decodeAudioBuffer,
  detectSilences,
  peaksToPolyline,
  type WavePeak,
} from '../lib/waveform';

const VIEW_WIDTH = 600;
const WAVE_HEIGHT = 88;
const BUCKETS = 600;
/** A snap only moves an edge this far to reach a pause. */
const SNAP_MAX_MS = 250;

/**
 * Fine-tunes which slice of a sentence's reference recording counts as
 * "just this word" — the span `SegmentLoopPlayer` loops and the
 * pitch-accent card models. The forced aligner + `isolatedWordRange`'s
 * character-proportion remap often land a little off (or can't place the
 * word at all); this lets the learner drag the two edges onto the pauses
 * they can see. The clip is only a few seconds so it decodes in the
 * browser — no server round trip, no iOS `decodeAudioData` ceiling.
 */
interface WordAudioRangeEditorProps {
  blob: Blob;
  /** Current effective word span — the handles start here. */
  value: TimeRangeMs;
  /** True when `value` is a saved override (shows "Reset to auto"). */
  hasOverride: boolean;
  /** Live during a drag — for the preview highlight + the parent's loop range. */
  onChange: (range: TimeRangeMs) => void;
  /** On drag end / snap — the point to persist. */
  onCommit: (range: TimeRangeMs) => void;
  onReset: () => void;
  disabled?: boolean;
}

export function WordAudioRangeEditor({
  blob,
  value,
  hasOverride,
  onChange,
  onCommit,
  onReset,
  disabled = false,
}: WordAudioRangeEditorProps) {
  const [peaks, setPeaks] = useState<WavePeak[]>([]);
  const [silenceMs, setSilenceMs] = useState<number[]>([]);
  const [durationMs, setDurationMs] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef<'start' | 'end' | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    void (async () => {
      try {
        const buffer = await decodeAudioBuffer(blob);
        const canonical = canonicalizeAudioBuffer(buffer);
        if (cancelled) return;
        setDurationMs(canonical.durationSeconds * 1000);
        setPeaks(computePeaks(canonical.samples, BUCKETS));
        setSilenceMs(
          detectSilences(canonical.samples, canonical.sampleRate).map(
            (s) => s.midSeconds * 1000,
          ),
        );
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob]);

  const wavePath = useMemo(
    () => peaksToPolyline(peaks, VIEW_WIDTH, WAVE_HEIGHT),
    [peaks],
  );

  const span = durationMs > 0 ? durationMs : Math.max(1, value.endMs);
  const xForMs = (ms: number) => (ms / span) * VIEW_WIDTH;

  const msForClientX = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(fraction * span);
  };

  const clampStart = (ms: number) => Math.max(0, Math.min(value.endMs - 1, ms));
  const clampEnd = (ms: number) => Math.min(span, Math.max(value.startMs + 1, ms));

  const handlePointerMove = (event: React.PointerEvent) => {
    const edge = draggingRef.current;
    if (!edge) return;
    const ms = msForClientX(event.clientX);
    if (edge === 'start') onChange({ startMs: clampStart(ms), endMs: value.endMs });
    else onChange({ startMs: value.startMs, endMs: clampEnd(ms) });
  };

  const endDrag = (event: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onCommit(value);
  };

  const nearestPause = (ms: number): number | null => {
    let best: number | null = null;
    let bestDist = SNAP_MAX_MS + 1;
    for (const mid of silenceMs) {
      const dist = Math.abs(mid - ms);
      if (dist < bestDist) {
        bestDist = dist;
        best = mid;
      }
    }
    return best;
  };

  const snapToPauses = () => {
    const start = nearestPause(value.startMs);
    const end = nearestPause(value.endMs);
    const next = {
      startMs: start !== null ? clampStart(start) : value.startMs,
      endMs: end !== null ? clampEnd(end) : value.endMs,
    };
    onChange(next);
    onCommit(next);
  };

  const beginDrag = (edge: 'start' | 'end') => (event: React.PointerEvent) => {
    if (disabled) return;
    draggingRef.current = edge;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handle = (edge: 'start' | 'end', ms: number) => {
    const x = xForMs(ms);
    return (
      <g>
        <line x1={x} x2={x} y1={0} y2={WAVE_HEIGHT} stroke="var(--accent)" strokeWidth={2} />
        <circle cx={x} cy={7} r={6} fill="var(--accent)" />
        <line
          x1={x}
          x2={x}
          y1={0}
          y2={WAVE_HEIGHT}
          stroke="transparent"
          strokeWidth={24}
          style={{ cursor: disabled ? 'default' : 'ew-resize' }}
          aria-label={edge === 'start' ? 'Word start' : 'Word end'}
          onPointerDown={beginDrag(edge)}
        />
      </g>
    );
  };

  return (
    <div className="stack" style={{ gap: '0.35rem' }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: '0.85em' }}>
          {status === 'loading'
            ? 'Loading waveform…'
            : status === 'error'
              ? 'Waveform unavailable — drag the edges by feel'
              : `${(value.startMs / 1000).toFixed(2)}s – ${(value.endMs / 1000).toFixed(2)}s`}
        </span>
        <div className="row" style={{ gap: '0.4rem' }}>
          <button
            type="button"
            disabled={disabled || status !== 'ready' || silenceMs.length === 0}
            onClick={snapToPauses}
          >
            Snap to pauses
          </button>
          {hasOverride ? (
            <button type="button" disabled={disabled} onClick={onReset}>
              Reset to auto
            </button>
          ) : null}
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_WIDTH} ${WAVE_HEIGHT}`}
        role="img"
        aria-label="Word audio range editor"
        style={{
          width: '100%',
          height: WAVE_HEIGHT,
          color: 'var(--text-muted)',
          touchAction: 'none',
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <rect
          x={xForMs(value.startMs)}
          width={Math.max(0, xForMs(value.endMs) - xForMs(value.startMs))}
          y={0}
          height={WAVE_HEIGHT}
          fill="var(--accent)"
          opacity={0.12}
        />
        {silenceMs.map((ms, i) => (
          <line
            key={`sil-${i}`}
            x1={xForMs(ms)}
            x2={xForMs(ms)}
            y1={0}
            y2={WAVE_HEIGHT}
            stroke="var(--border)"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
        ))}
        <polyline fill="none" stroke="currentColor" strokeWidth={1.5} points={wavePath} />
        {handle('start', value.startMs)}
        {handle('end', value.endMs)}
      </svg>
    </div>
  );
}
