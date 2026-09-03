import { useEffect, useMemo, useRef, useState } from 'react';

import type { SpanWaveform } from '../lib/miningApi';
import {
  setRowBoundary,
  snapBoundariesToSilences,
  type ResegmentReviewRow,
} from '../lib/resegmentPlan';
import { peaksToPolyline, type WavePeak } from '../lib/waveform';

const VIEW_WIDTH = 600;
const WAVE_HEIGHT = 96;

/**
 * A waveform of the whole reviewed span with a draggable vertical handle at
 * every internal row boundary — drop a boundary onto the pause you can see,
 * instead of nudging millisecond numbers. "Snap to pauses" moves every
 * boundary to the nearest silence. The peaks and silence midpoints are
 * computed server-side (ffmpeg) and fetched via `waveformForRange`; the
 * browser never decodes the span itself (a multi-minute `decodeAudioData`
 * fails on iOS Safari). Rendered by `SegmentationEditor` only when it's
 * given a `waveformForRange` fetcher.
 */
interface SegmentationWaveformProps {
  rows: ResegmentReviewRow[];
  onRowsChange: (rows: ResegmentReviewRow[]) => void;
  waveformForRange: (startMs: number, endMs: number) => Promise<SpanWaveform>;
  disabled?: boolean;
}

export function SegmentationWaveform({
  rows,
  onRowsChange,
  waveformForRange,
  disabled = false,
}: SegmentationWaveformProps) {
  const spanStartMs = rows[0]?.startMs ?? 0;
  const spanEndMs = rows[rows.length - 1]?.endMs ?? 0;
  const spanMs = spanEndMs - spanStartMs;

  const [peaks, setPeaks] = useState<WavePeak[]>([]);
  const [silenceMidsMs, setSilenceMidsMs] = useState<number[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef<number | null>(null);

  // Re-fetch only when the outer span moves — dragging an internal boundary
  // shifts rows but not spanStart/spanEnd, so the waveform stays put.
  useEffect(() => {
    if (spanMs <= 0) return;
    let cancelled = false;
    setStatus('loading');
    void (async () => {
      try {
        const waveform = await waveformForRange(spanStartMs, spanEndMs);
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
  }, [waveformForRange, spanStartMs, spanEndMs, spanMs]);

  const wavePath = useMemo(
    () => peaksToPolyline(peaks, VIEW_WIDTH, WAVE_HEIGHT),
    [peaks],
  );

  const xForMs = (ms: number) =>
    spanMs > 0 ? ((ms - spanStartMs) / spanMs) * VIEW_WIDTH : 0;

  const msForClientX = (clientX: number): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return spanStartMs;
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return spanStartMs + fraction * spanMs;
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const index = draggingRef.current;
    if (index === null) return;
    onRowsChange(setRowBoundary(rows, index, msForClientX(event.clientX)));
  };

  const endDrag = (event: React.PointerEvent) => {
    if (draggingRef.current === null) return;
    draggingRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  if (spanMs <= 0) return null;

  return (
    <section className="panel stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">
          {status === 'loading'
            ? 'Loading waveform…'
            : status === 'error'
              ? 'Waveform unavailable — edit boundaries below.'
              : 'Drag a divider onto a pause, or snap them all.'}
        </span>
        <button
          type="button"
          disabled={disabled || status !== 'ready' || silenceMidsMs.length === 0}
          onClick={() => onRowsChange(snapBoundariesToSilences(rows, silenceMidsMs))}
        >
          Snap to pauses
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_WIDTH} ${WAVE_HEIGHT}`}
        role="img"
        aria-label="Reviewed span waveform with sentence boundaries"
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
        {rows.slice(1).map((row, i) => {
          const boundaryIndex = i + 1;
          const x = xForMs(row.startMs);
          return (
            <g key={`bnd-${boundaryIndex}`}>
              <line
                x1={x}
                x2={x}
                y1={0}
                y2={WAVE_HEIGHT}
                stroke="var(--accent)"
                strokeWidth={2}
              />
              {/* Fat invisible hit target for the drag. */}
              <line
                x1={x}
                x2={x}
                y1={0}
                y2={WAVE_HEIGHT}
                stroke="transparent"
                strokeWidth={14}
                style={{ cursor: disabled ? 'default' : 'ew-resize' }}
                aria-label={`Boundary before sentence ${boundaryIndex + 1}`}
                onPointerDown={(event) => {
                  if (disabled) return;
                  draggingRef.current = boundaryIndex;
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                }}
              />
            </g>
          );
        })}
      </svg>
    </section>
  );
}
