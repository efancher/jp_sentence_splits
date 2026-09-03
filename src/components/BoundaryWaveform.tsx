import { useEffect, useMemo, useRef, useState } from 'react';

import type { SpanWaveform } from '../lib/miningApi';
import { peaksToPolyline, type WavePeak } from '../lib/waveform';

const VIEW_WIDTH = 600;
const WAVE_HEIGHT = 96;
/** Context shown either side of the sentence so a nearby pause is visible. */
const PAD_MS = 1500;
/** A "snap" only moves an edge this far to reach a pause. */
const SNAP_MAX_MS = 400;

/**
 * A zoomed waveform of one sentence (its span ± ~1.5 s of context) with a
 * draggable handle on each editable edge — drop the edge onto the pause you
 * can see. Peaks + pause midpoints come from the server (`waveformForRange`,
 * ffmpeg); the browser never decodes audio. `SegmentationEditor` renders one
 * of these on demand under the row being tuned, so a long podcast never has
 * to fit on a single strip. The view window is fixed when it opens — drag
 * an edge to the frame edge and reopen to recentre.
 */
interface BoundaryWaveformProps {
  startMs: number;
  endMs: number;
  /** Floor for the start edge (previous row's start, or this row's start). */
  minStartMs: number;
  /** Ceiling for the end edge (next row's end, or this row's end). */
  maxEndMs: number;
  canEditStart: boolean;
  canEditEnd: boolean;
  waveformForRange: (startMs: number, endMs: number) => Promise<SpanWaveform>;
  onStartChange: (ms: number) => void;
  onEndChange: (ms: number) => void;
  disabled?: boolean;
}

export function BoundaryWaveform({
  startMs,
  endMs,
  minStartMs,
  maxEndMs,
  canEditStart,
  canEditEnd,
  waveformForRange,
  onStartChange,
  onEndChange,
  disabled = false,
}: BoundaryWaveformProps) {
  // Frozen when the editor opens so dragging an edge doesn't re-fetch.
  const [view] = useState(() => ({
    start: Math.max(0, startMs - PAD_MS),
    end: endMs + PAD_MS,
  }));
  const viewMs = view.end - view.start;

  const [peaks, setPeaks] = useState<WavePeak[]>([]);
  const [silenceMidsMs, setSilenceMidsMs] = useState<number[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef<'start' | 'end' | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    void (async () => {
      try {
        const waveform = await waveformForRange(view.start, view.end);
        if (cancelled) return;
        setPeaks(waveform.peaks);
        setSilenceMidsMs(waveform.silenceMidsMs);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [waveformForRange, view.start, view.end]);

  const wavePath = useMemo(
    () => peaksToPolyline(peaks, VIEW_WIDTH, WAVE_HEIGHT),
    [peaks],
  );

  const xForMs = (ms: number) => ((ms - view.start) / viewMs) * VIEW_WIDTH;

  const msForClientX = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return view.start;
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(view.start + fraction * viewMs);
  };

  const clampStart = (ms: number) => Math.min(endMs - 1, Math.max(minStartMs, ms));
  const clampEnd = (ms: number) => Math.max(startMs + 1, Math.min(maxEndMs, ms));

  const handlePointerMove = (event: React.PointerEvent) => {
    const edge = draggingRef.current;
    if (!edge) return;
    const ms = msForClientX(event.clientX);
    if (edge === 'start') onStartChange(clampStart(ms));
    else onEndChange(clampEnd(ms));
  };

  const endDrag = (event: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const nearestPause = (ms: number): number | null => {
    let best: number | null = null;
    let bestDist = SNAP_MAX_MS + 1;
    for (const mid of silenceMidsMs) {
      const dist = Math.abs(mid - ms);
      if (dist < bestDist) {
        bestDist = dist;
        best = mid;
      }
    }
    return bestDist <= SNAP_MAX_MS ? best : null;
  };

  const snapToPauses = () => {
    if (canEditStart) {
      const pause = nearestPause(startMs);
      if (pause !== null) onStartChange(clampStart(pause));
    }
    if (canEditEnd) {
      const pause = nearestPause(endMs);
      if (pause !== null) onEndChange(clampEnd(pause));
    }
  };

  const beginDrag = (edge: 'start' | 'end') => (event: React.PointerEvent) => {
    if (disabled) return;
    draggingRef.current = edge;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handle = (edge: 'start' | 'end', ms: number) => {
    const x = xForMs(ms);
    return (
      <g key={edge}>
        <line x1={x} x2={x} y1={0} y2={WAVE_HEIGHT} stroke="var(--accent)" strokeWidth={2} />
        <circle cx={x} cy={8} r={6} fill="var(--accent)" />
        <line
          x1={x}
          x2={x}
          y1={0}
          y2={WAVE_HEIGHT}
          stroke="transparent"
          strokeWidth={24}
          style={{ cursor: disabled ? 'default' : 'ew-resize' }}
          aria-label={edge === 'start' ? 'Sentence start' : 'Sentence end'}
          onPointerDown={beginDrag(edge)}
        />
      </g>
    );
  };

  const canSnap =
    status === 'ready' &&
    silenceMidsMs.length > 0 &&
    (canEditStart || canEditEnd) &&
    !disabled;

  return (
    <div className="stack" style={{ gap: '0.35rem' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted" style={{ fontSize: '0.85em' }}>
          {status === 'loading'
            ? 'Loading waveform…'
            : status === 'error'
              ? 'Waveform unavailable — drag not available'
              : `${(startMs / 1000).toFixed(2)}s – ${(endMs / 1000).toFixed(2)}s · ${(
                  (endMs - startMs) / 1000
                ).toFixed(2)}s`}
        </span>
        <button type="button" disabled={!canSnap} onClick={snapToPauses}>
          Snap to pauses
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_WIDTH} ${WAVE_HEIGHT}`}
        role="img"
        aria-label="Sentence waveform with draggable start and end"
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
          x={xForMs(startMs)}
          width={Math.max(0, xForMs(endMs) - xForMs(startMs))}
          y={0}
          height={WAVE_HEIGHT}
          fill="var(--accent)"
          opacity={0.12}
        />
        {silenceMidsMs.map((ms, i) => (
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
        {canEditStart ? handle('start', startMs) : null}
        {canEditEnd ? handle('end', endMs) : null}
      </svg>
    </div>
  );
}
