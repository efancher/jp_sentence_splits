import { useMemo } from 'react';

import type { AlignmentResult } from '../domain/types';
import type { TimingObservation } from '../lib/timingObservations';
import { buildTimingChartRows } from '../lib/wordTimingObservations';

/** Within this ratio of the reference a bar is drawn as "about the same". */
const SAME_RATIO = 0.2;

function verdict(refMs: number, learnerMs: number): 'slower' | 'faster' | 'same' {
  if (refMs <= 0) return 'same';
  const ratio = learnerMs / refMs;
  if (ratio > 1 + SAME_RATIO) return 'slower';
  if (ratio < 1 - SAME_RATIO) return 'faster';
  return 'same';
}

function Bars({ refMs, learnerMs, scaleMs, compact }: { refMs: number; learnerMs: number; scaleMs: number; compact?: boolean }) {
  const pct = (ms: number) => `${Math.max(2, Math.min(100, (ms / scaleMs) * 100))}%`;
  return (
    <div className="stc-bars" data-compact={compact ? '' : undefined}>
      <div className="stc-bar stc-bar-ref" style={{ width: pct(refMs) }} title={`Reference ${Math.round(refMs)}ms`} />
      <div
        className="stc-bar stc-bar-you"
        data-v={verdict(refMs, learnerMs)}
        style={{ width: pct(learnerMs) }}
        title={`You ${Math.round(learnerMs)}ms`}
      />
    </div>
  );
}

/**
 * Word-by-word durations as paired bars on one shared scale: grey = the reference, coloured = you
 * (orange = slower, blue = faster, green = about the same). A held 「っ」 or long vowel that was called
 * out gets its own small pair under its word. Same pairs and thresholds as the written feedback
 * (`buildWordTimingObservations`), which stays available under "Details".
 */
export function SegmentTimingChart({
  reference,
  learner,
  observations,
}: {
  reference: AlignmentResult;
  learner: AlignmentResult;
  observations: readonly TimingObservation[];
}) {
  const rows = useMemo(() => buildTimingChartRows({ reference, learner, observations }), [reference, learner, observations]);
  const scaleMs = useMemo(
    () => Math.max(1, ...rows.flatMap((r) => [r.refMs, r.learnerMs])),
    [rows],
  );
  const phoneScaleMs = useMemo(
    () => Math.max(1, ...rows.flatMap((r) => r.phones.flatMap((p) => [p.refMs, p.learnerMs]))),
    [rows],
  );
  if (rows.length === 0) return null;

  return (
    <div className="stc" role="img" aria-label="Word durations, reference versus you">
      <div className="stc-legend muted">
        <span><i className="stc-key stc-bar-ref" /> reference</span>
        <span><i className="stc-key stc-bar-you" data-v="slower" /> you, slower</span>
        <span><i className="stc-key stc-bar-you" data-v="faster" /> you, faster</span>
        <span><i className="stc-key stc-bar-you" data-v="same" /> about the same</span>
      </div>
      {rows.map((row, index) => (
        <div key={index} className="stc-row" data-flagged={row.flagged ? '' : undefined}>
          <span className="stc-word jp">{row.text}</span>
          <div className="stc-main">
            <Bars refMs={row.refMs} learnerMs={row.learnerMs} scaleMs={scaleMs} />
            {row.flagged ? (
              <span className="stc-ms muted">
                {Math.round(row.refMs)} → {Math.round(row.learnerMs)}ms
              </span>
            ) : null}
            {row.phones.map((phone, i) => (
              <div key={i} className="stc-phone" data-confidence={phone.confidence}>
                <span className="stc-phone-label jp">{phone.label}</span>
                <Bars refMs={phone.refMs} learnerMs={phone.learnerMs} scaleMs={phoneScaleMs} compact />
                <span className="stc-ms muted">
                  {Math.round(phone.refMs)} → {Math.round(phone.learnerMs)}ms
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
