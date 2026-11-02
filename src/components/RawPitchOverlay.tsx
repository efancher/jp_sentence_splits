import { useMemo } from 'react';

import type { PitchAnalysisPayload } from '../lib/pitch';

const WIDTH = 600;
const HEIGHT = 200;
const PAD_LEFT = 38;
const PAD_RIGHT = 6;
const PAD_Y = 10;

export interface RawPitchScale {
  /** Seconds shown across the full width — the longer of the two clips. */
  durationSeconds: number;
  minHz: number;
  maxHz: number;
}

/** Shared axes for both contours: real clip time from 0 and absolute Hz (log-spaced, padded). Null when neither clip has a voiced frame. */
export function rawPitchScale(
  reference: PitchAnalysisPayload | undefined,
  learner: PitchAnalysisPayload | undefined,
): RawPitchScale | null {
  const hz: number[] = [];
  let durationSeconds = 0;
  for (const pitch of [reference, learner]) {
    if (!pitch) continue;
    durationSeconds = Math.max(durationSeconds, pitch.durationSeconds);
    for (const frame of pitch.frames) {
      if (frame.voiced && frame.hz !== null && frame.hz > 0) hz.push(frame.hz);
    }
  }
  if (hz.length === 0 || durationSeconds <= 0) return null;
  return { durationSeconds, minHz: Math.min(...hz) / 1.06, maxHz: Math.max(...hz) * 1.06 };
}

/** Unadjusted contour as polyline runs: x is real seconds from the clip start, y is absolute Hz on a log axis. Unvoiced frames break the line. */
export function rawPitchRuns(
  pitch: PitchAnalysisPayload | undefined,
  scale: RawPitchScale,
): string[] {
  if (!pitch) return [];
  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const logMin = Math.log(scale.minHz);
  const logSpan = Math.max(0.001, Math.log(scale.maxHz) - logMin);
  const runs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length === 1) {
      const [px, py] = current[0]!.split(',');
      current.push(`${(Number(px) + 0.01).toFixed(2)},${py}`);
    }
    if (current.length > 0) runs.push(current.join(' '));
    current = [];
  };
  for (const frame of pitch.frames) {
    if (!frame.voiced || frame.hz === null || frame.hz <= 0) {
      flush();
      continue;
    }
    const x = PAD_LEFT + (frame.timeSeconds / scale.durationSeconds) * plotW;
    const y = PAD_Y + (1 - (Math.log(frame.hz) - logMin) / logSpan) * (HEIGHT - 2 * PAD_Y);
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  flush();
  return runs;
}

/** Round Hz gridline values that fall inside the scale. */
function hzTicks(scale: RawPitchScale): number[] {
  const candidates = [60, 80, 100, 125, 150, 200, 250, 300, 400, 500, 600];
  return candidates.filter((hz) => hz >= scale.minHz && hz <= scale.maxHz);
}

/**
 * Reference and attempt pitch drawn on one pair of axes with no normalization:
 * real seconds from each clip's start (no stretching to match length or
 * speech onset) and absolute Hz (no per-speaker median centring) — for trying
 * a full imitation of the speaker's voice rather than matching shape.
 */
export function RawPitchOverlay({
  reference,
  learner,
}: {
  reference: PitchAnalysisPayload | undefined;
  learner: PitchAnalysisPayload | undefined;
}) {
  const scale = useMemo(() => rawPitchScale(reference, learner), [reference, learner]);
  const referenceRuns = useMemo(() => (scale ? rawPitchRuns(reference, scale) : []), [reference, scale]);
  const learnerRuns = useMemo(() => (scale ? rawPitchRuns(learner, scale) : []), [learner, scale]);
  if (!scale) return <p className="muted">Too little voiced sound to plot a contour.</p>;

  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const logMin = Math.log(scale.minHz);
  const logSpan = Math.max(0.001, Math.log(scale.maxHz) - logMin);
  const yFor = (hz: number) => PAD_Y + (1 - (Math.log(hz) - logMin) / logSpan) * (HEIGHT - 2 * PAD_Y);
  const seconds = Array.from({ length: Math.floor(scale.durationSeconds) + 1 }, (_, i) => i);

  return (
    <div className="stack">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT + 14}`}
        role="img"
        aria-label="Reference and attempt pitch in Hz over real time"
        style={{ width: '100%', color: 'var(--text-muted)' }}
      >
        {hzTicks(scale).map((hz) => (
          <g key={hz}>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={yFor(hz)}
              y2={yFor(hz)}
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeDasharray="3 3"
            />
            <text x={PAD_LEFT - 4} y={yFor(hz) + 3} textAnchor="end" fontSize="9" fill="currentColor">
              {hz}
            </text>
          </g>
        ))}
        {seconds.map((s) => (
          <text
            key={s}
            x={PAD_LEFT + (s / scale.durationSeconds) * plotW}
            y={HEIGHT + 10}
            textAnchor="middle"
            fontSize="9"
            fill="currentColor"
          >
            {s}s
          </text>
        ))}
        {referenceRuns.map((points, i) => (
          <polyline
            key={`r${i}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />
        ))}
        {learnerRuns.map((points, i) => (
          <polyline
            key={`l${i}`}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />
        ))}
      </svg>
      <p className="muted" style={{ fontSize: '0.8em', margin: 0 }}>
        Grey is the reference, gold is your attempt — absolute Hz and real elapsed time from the start
        of each clip, with nothing stretched, shifted or centred.
        {reference?.medianHz ? ` Reference median ${Math.round(reference.medianHz)} Hz` : ''}
        {learner?.medianHz ? `, yours ${Math.round(learner.medianHz)} Hz` : ''}
        {reference?.medianHz ? '.' : ''}
      </p>
    </div>
  );
}
