import type { TimeRangeMs } from '../lib/recording';

const MIN_WINDOW_MS = 200;
const STEP_MS = 50;
const GAP_STEP_MS = 100;
export const MAX_LOOP_GAP_MS = 3000;
export const MAX_LOOP_LEAD_IN_MS = 3000;

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

/**
 * Start / end sliders for the loop window plus the pause between reps. Meant to be dragged while the
 * loop keeps running, so each change is reported immediately; the window can never shrink below
 * `MIN_WINDOW_MS` (the handles stop at each other instead of crossing).
 */
export function LoopWindowControls({
  durationMs,
  range,
  gapMs,
  leadInMs,
  onRangeChange,
  onGapChange,
  onLeadInChange,
  onReset,
}: {
  durationMs: number;
  /** The window currently in effect (the whole clip when nothing is marked). */
  range: TimeRangeMs;
  gapMs: number;
  /** Recorded countdown before the native audio starts each rep. */
  leadInMs: number;
  onRangeChange: (range: TimeRangeMs) => void;
  onGapChange: (gapMs: number) => void;
  onLeadInChange: (leadInMs: number) => void;
  onReset: () => void;
}) {
  const wholeClip = range.startMs <= 0 && range.endMs >= durationMs;
  return (
    <details className="stack" style={{ gap: '0.4rem' }}>
      <summary className="muted" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
        Loop window {seconds(range.startMs)}–{seconds(range.endMs)}
        {gapMs > 0 ? ` · ${(gapMs / 1000).toFixed(1)}s pause` : ''}
        {leadInMs > 0 ? ` · ${(leadInMs / 1000).toFixed(1)}s lead-in` : ''}
      </summary>
      <label className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ minWidth: '3.2rem' }}>Start</span>
        <input
          type="range"
          style={{ flex: 1 }}
          min={0}
          max={durationMs}
          step={STEP_MS}
          value={range.startMs}
          aria-label="Loop start"
          onChange={(event) =>
            onRangeChange({ startMs: Math.min(Number(event.target.value), range.endMs - MIN_WINDOW_MS), endMs: range.endMs })
          }
        />
      </label>
      <label className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ minWidth: '3.2rem' }}>End</span>
        <input
          type="range"
          style={{ flex: 1 }}
          min={0}
          max={durationMs}
          step={STEP_MS}
          value={range.endMs}
          aria-label="Loop end"
          onChange={(event) =>
            onRangeChange({ startMs: range.startMs, endMs: Math.max(Number(event.target.value), range.startMs + MIN_WINDOW_MS) })
          }
        />
      </label>
      <label className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ minWidth: '3.2rem' }}>Pause</span>
        <input
          type="range"
          style={{ flex: 1 }}
          min={0}
          max={MAX_LOOP_GAP_MS}
          step={GAP_STEP_MS}
          value={gapMs}
          aria-label="Pause between loops"
          onChange={(event) => onGapChange(Number(event.target.value))}
        />
        <span className="muted" style={{ minWidth: '2.5rem' }}>{(gapMs / 1000).toFixed(1)}s</span>
      </label>
      <label className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ minWidth: '3.2rem' }}>Lead-in</span>
        <input
          type="range"
          style={{ flex: 1 }}
          min={0}
          max={MAX_LOOP_LEAD_IN_MS}
          step={GAP_STEP_MS}
          value={leadInMs}
          aria-label="Lead-in before each rep"
          onChange={(event) => onLeadInChange(Number(event.target.value))}
        />
        <span className="muted" style={{ minWidth: '2.5rem' }}>{(leadInMs / 1000).toFixed(1)}s</span>
      </label>
      {wholeClip ? null : (
        <div>
          <button type="button" onClick={onReset}>
            Whole sentence
          </button>
        </div>
      )}
    </details>
  );
}
