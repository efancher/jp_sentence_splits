import { useMemo, useRef, useState } from 'react';

import { edgeWindow, msAtX, xAtMs, EDGE_WINDOW_HALF_MS } from '../lib/boundaryEditor';
import { computePeaks } from '../lib/waveform';

const VIEW_WIDTH = 600;
const WAVE_HEIGHT = 96;
const BUCKETS = 300;

/**
 * One zoomed edge of the word span, for hand-labelling
 * (`LabelWordAudioPage`). Shows ±400 ms of waveform around the edge so 10 ms is
 * ~7 px (the whole-sentence `WordAudioRangeEditor` gives ~1 px). Drag the
 * handle, or nudge it with the buttons (±1, ±10, and ±100 ms for a big miss) or
 * the arrow keys (1 ms; Shift 10 ms). The
 * view re-centres on the edge when a drag ends so a long correction is never
 * stuck at the window's border. Auditioning is owned by the parent.
 */
export function BoundaryEdgeEditor({
  kind,
  buffer,
  edgeMs,
  otherEdgeMs,
  onChange,
  onAudition,
  disabled = false,
}: {
  kind: 'start' | 'end';
  buffer: AudioBuffer;
  edgeMs: number;
  otherEdgeMs: number;
  onChange: (ms: number) => void;
  /** Play the audio just `outside` or `inside` this edge. */
  onAudition: (which: 'outside' | 'inside') => void;
  disabled?: boolean;
}) {
  const durationMs = buffer.duration * 1000;
  const [centerMs, setCenterMs] = useState(edgeMs);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);
  const win = useMemo(() => edgeWindow(centerMs, durationMs), [centerMs, durationMs]);

  const path = useMemo(() => {
    const data = buffer.getChannelData(0);
    const a = Math.floor((win.startMs / 1000) * buffer.sampleRate);
    const b = Math.min(data.length, Math.ceil((win.endMs / 1000) * buffer.sampleRate));
    const peaks = computePeaks(data.subarray(a, b), BUCKETS);
    // Normalise to the window's own loudest peak so quiet edges stay readable.
    const scale = Math.max(0.05, ...peaks.map((p) => Math.max(p.max, -p.min)));
    const mid = WAVE_HEIGHT / 2;
    return peaks
      .map((p, i) => {
        const x = (i / (BUCKETS - 1)) * VIEW_WIDTH;
        return `M${x.toFixed(1)} ${(mid - (p.max / scale) * mid).toFixed(1)}V${(mid - (p.min / scale) * mid).toFixed(1)}`;
      })
      .join('');
  }, [buffer, win]);

  const pointerMs = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return msAtX(event.clientX - rect.left, rect.width, win);
  };

  const move = (ms: number) => onChange(Math.round(ms));
  const nudge = (deltaMs: number) => {
    move(edgeMs + deltaMs);
    setCenterMs(edgeMs + deltaMs);
  };

  const ticks: number[] = [];
  for (let t = Math.ceil(win.startMs / 100) * 100; t <= win.endMs; t += 100) ticks.push(t);

  const audition = kind === 'start'
    ? { outside: 'Hear before (no word yet)', inside: 'Hear after (starts with the word)' }
    : { outside: 'Hear after (word is over)', inside: 'Hear before (ends with the word)' };

  return (
    <div className="stack" style={{ gap: '0.35rem' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>{kind === 'start' ? 'Start' : 'End'}</strong>
        <span className="muted">{Math.round(edgeMs)} ms</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_WIDTH} ${WAVE_HEIGHT}`}
        preserveAspectRatio="none"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${kind === 'start' ? 'Start' : 'End'} edge — arrow keys nudge 1 ms, Shift 10 ms`}
        aria-valuemin={Math.round(win.startMs)}
        aria-valuemax={Math.round(win.endMs)}
        aria-valuenow={Math.round(edgeMs)}
        style={{ width: '100%', height: WAVE_HEIGHT, touchAction: 'none', color: 'var(--text-muted)' }}
        onPointerDown={(event) => {
          if (disabled) return;
          draggingRef.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          move(pointerMs(event));
        }}
        onPointerMove={(event) => {
          if (draggingRef.current) move(pointerMs(event));
        }}
        onPointerUp={() => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          setCenterMs(edgeMs);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          const step = event.shiftKey ? 10 : 1;
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            nudge(-step);
          } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            nudge(step);
          }
        }}
      >
        {/* The part of the window that is inside the word, lightly shaded. */}
        {(() => {
          const a = xAtMs(Math.min(edgeMs, otherEdgeMs), VIEW_WIDTH, win);
          const b = xAtMs(Math.max(edgeMs, otherEdgeMs), VIEW_WIDTH, win);
          const left = Math.max(0, Math.min(VIEW_WIDTH, a));
          const right = Math.max(0, Math.min(VIEW_WIDTH, b));
          return <rect x={left} width={Math.max(0, right - left)} y={0} height={WAVE_HEIGHT} fill="var(--accent)" opacity={0.12} />;
        })()}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={xAtMs(t, VIEW_WIDTH, win)} x2={xAtMs(t, VIEW_WIDTH, win)} y1={0} y2={WAVE_HEIGHT} stroke="currentColor" opacity={0.18} />
            <text x={xAtMs(t, VIEW_WIDTH, win) + 2} y={10} fontSize={9} fill="currentColor" opacity={0.6}>{t}</text>
          </g>
        ))}
        <path d={path} stroke="currentColor" strokeWidth={1} fill="none" />
        {otherEdgeMs >= win.startMs && otherEdgeMs <= win.endMs && (
          <line x1={xAtMs(otherEdgeMs, VIEW_WIDTH, win)} x2={xAtMs(otherEdgeMs, VIEW_WIDTH, win)} y1={0} y2={WAVE_HEIGHT} stroke="var(--accent)" strokeDasharray="4 3" opacity={0.7} />
        )}
        <line x1={xAtMs(edgeMs, VIEW_WIDTH, win)} x2={xAtMs(edgeMs, VIEW_WIDTH, win)} y1={0} y2={WAVE_HEIGHT} stroke="var(--accent)" strokeWidth={2} />
      </svg>
      <div className="row" style={{ flexWrap: 'wrap', gap: '0.25rem' }}>
        {[-100, -10, -1, 1, 10, 100].map((d) => (
          <button key={d} type="button" className="secondary" disabled={disabled} onClick={() => nudge(d)} aria-label={`Move ${kind} edge ${d} ms`}>
            {d > 0 ? `+${d}` : d}
          </button>
        ))}
        <button type="button" className="secondary" disabled={disabled} onClick={() => onAudition('outside')}>{audition.outside}</button>
        <button type="button" className="secondary" disabled={disabled} onClick={() => onAudition('inside')}>{audition.inside}</button>
      </div>
      <div className="muted" style={{ fontSize: '0.8rem' }}>Showing ±{EDGE_WINDOW_HALF_MS} ms around this edge; ticks every 100 ms.</div>
    </div>
  );
}
