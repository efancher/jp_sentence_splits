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
 * A zoomed waveform of one sentence (its span + context) with a draggable
 * handle on each edge — drop the edge onto the pause you can see, then hit
 * "Play selection" to hear exactly the span between the handles. Peaks +
 * pause midpoints come from the server (`waveformForRange`, ffmpeg); the
 * browser never decodes audio. `SegmentationEditor` renders one of these on
 * demand under the row being tuned, so a long podcast never has to fit on a
 * single strip. The view window is fixed when it opens — `padStartMs` /
 * `padEndMs` give the first/last row extra room to drag toward 0 / the end;
 * drag an edge to the frame edge and reopen to recentre.
 */
interface BoundaryWaveformProps {
  startMs: number;
  endMs: number;
  /** Floor for the start edge (previous row's start, or 0 for the first row). */
  minStartMs: number;
  /** Ceiling for the end edge (next row's end, or the media duration). */
  maxEndMs: number;
  waveformForRange: (startMs: number, endMs: number) => Promise<SpanWaveform>;
  /** Fetches the audio for an arbitrary span — powers "Play selection". */
  audioForRange?: (startMs: number, endMs: number) => Promise<Blob>;
  onStartChange: (ms: number) => void;
  onEndChange: (ms: number) => void;
  /** Left/right context width; defaults to `PAD_MS`. */
  padStartMs?: number;
  padEndMs?: number;
  disabled?: boolean;
}

export function BoundaryWaveform({
  startMs,
  endMs,
  minStartMs,
  maxEndMs,
  waveformForRange,
  audioForRange,
  onStartChange,
  onEndChange,
  padStartMs = PAD_MS,
  padEndMs = PAD_MS,
  disabled = false,
}: BoundaryWaveformProps) {
  // Frozen when the editor opens so dragging an edge doesn't re-fetch.
  const [view] = useState(() => ({
    start: Math.max(0, startMs - padStartMs),
    end: endMs + padEndMs,
  }));
  const viewMs = view.end - view.start;

  const [peaks, setPeaks] = useState<WavePeak[]>([]);
  const [silenceMidsMs, setSilenceMidsMs] = useState<number[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [playing, setPlaying] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef<'start' | 'end' | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

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

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    },
    [],
  );

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
    const startPause = nearestPause(startMs);
    if (startPause !== null) onStartChange(clampStart(startPause));
    const endPause = nearestPause(endMs);
    if (endPause !== null) onEndChange(clampEnd(endPause));
  };

  // Always re-fetches the current [startMs, endMs] so a play right after a
  // drag reflects the edit (unlike the cached row-level button).
  async function playSelection() {
    if (!audioForRange) return;
    audioRef.current?.pause();
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setPlaying(true);
    try {
      const blob = await audioForRange(startMs, endMs);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const el = new Audio(url);
      audioRef.current = el;
      el.onended = () => setPlaying(false);
      el.onpause = () => setPlaying(false);
      await el.play();
    } catch {
      setPlaying(false);
    }
  }

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

  return (
    <div className="stack" style={{ gap: '0.35rem' }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: '0.85em' }}>
          {status === 'loading'
            ? 'Loading waveform…'
            : status === 'error'
              ? 'Waveform unavailable — drag by feel, or play to check'
              : `${(startMs / 1000).toFixed(2)}s – ${(endMs / 1000).toFixed(2)}s · ${(
                  (endMs - startMs) / 1000
                ).toFixed(2)}s`}
        </span>
        <div className="row" style={{ gap: '0.4rem' }}>
          {audioForRange ? (
            <button type="button" disabled={disabled || playing} onClick={() => void playSelection()}>
              {playing ? '▶ …' : '▶ Play selection'}
            </button>
          ) : null}
          <button
            type="button"
            disabled={disabled || status !== 'ready' || silenceMidsMs.length === 0}
            onClick={snapToPauses}
          >
            Snap to pauses
          </button>
        </div>
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
        {handle('start', startMs)}
        {handle('end', endMs)}
      </svg>
    </div>
  );
}
