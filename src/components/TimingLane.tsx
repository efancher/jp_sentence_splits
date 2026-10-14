import { useState } from 'react';
import type { TimingLane as TimingLaneData, TimingLaneMark } from '../lib/timingLane';

const LATE_SECONDS = 0.08;

function markColor(mark: TimingLaneMark): string {
  const offset = mark.offsetSeconds;
  if (offset === undefined || Math.abs(offset) < LATE_SECONDS) return 'var(--border)';
  return offset > 0 ? 'hsl(25 85% 55%)' : 'hsl(210 80% 55%)';
}

function Row({ marks, axis, label }: { marks: TimingLaneMark[]; axis: number; label: string }) {
  return (
    <div aria-label={label} style={{ position: 'relative', width: '100%', height: '1.6em' }}>
      {marks.map((mark, index) => {
        const left = (mark.start / axis) * 100;
        const width = Math.max(0.5, ((mark.end - mark.start) / axis) * 100);
        const offset = mark.offsetSeconds;
        const title =
          offset === undefined
            ? mark.text
            : `${mark.text}: ${offset >= 0 ? '+' : ''}${Math.round(offset * 1000)} ms vs reference`;
        return (
          <span
            key={`${mark.text}-${index}`}
            className="jp"
            title={mark.exact ? title : `${title} (estimated position)`}
            style={{
              position: 'absolute',
              left: `${left}%`,
              width: `${Math.min(width, 100 - left)}%`,
              textAlign: 'center',
              fontSize: '0.72em',
              lineHeight: 1.6,
              color: 'var(--text-muted)',
              opacity: mark.exact ? 1 : 0.55,
              borderLeft: `2px ${mark.exact ? 'solid' : 'dashed'} ${markColor(mark)}`,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {mark.text}
          </span>
        );
      })}
    </div>
  );
}

export function TimingLane({
  lane,
  matchSpeed,
  onMatchSpeedChange,
}: {
  lane: TimingLaneData;
  matchSpeed: boolean;
  onMatchSpeedChange: (value: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const anyApproximate = [...lane.reference, ...lane.learner].some((m) => !m.exact);
  const pct = Math.round((lane.speedRatio - 1) * 100);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Timing (real time)</strong>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open ? (
        <>
          <span className="muted" style={{ fontSize: '0.75em' }}>Reference</span>
          <Row marks={lane.reference} axis={lane.axisSeconds} label="Reference mora timing" />
          <span className="muted" style={{ fontSize: '0.75em' }}>You</span>
          <Row marks={lane.learner} axis={lane.axisSeconds} label="Learner mora timing" />
          <label className="row" style={{ gap: 6, fontSize: '0.85em' }}>
            <input
              type="checkbox"
              checked={matchSpeed}
              onChange={(event) => onMatchSpeedChange(event.target.checked)}
            />
            Match my overall speed to the reference
          </label>
          <p className="muted" style={{ fontSize: '0.8em', margin: 0 }}>
            Your take was {Math.abs(pct)}% {pct >= 0 ? 'slower' : 'faster'} overall.
            {lane.paired
              ? ' Orange marks landed late and blue early (80 ms or more); hover for the exact offset.'
              : ' Mora counts differ between the two takes, so per-mora offsets are not shown.'}
            {anyApproximate ? ' Faint, dashed marks are estimated positions.' : ''} Unlike the pitch
            contours above, this axis is real time, not stretched per take.
          </p>
        </>
      ) : null}
    </div>
  );
}
