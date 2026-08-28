import { useId } from 'react';

import { segmentIntoMorae } from '../lib/mora';
import { expectedPitchShape, pitchPatternLabel } from '../lib/pitchAccentShape';

/**
 * Static mora-by-mora high/low pitch contour for a dictionary accent
 * position — the display half of `pitchAccentShape.ts`'s classification
 * logic (`immersion_pitch.py`'s `pitch_graph_html` was deliberately not
 * ported when that module landed; this is a lean React/SVG stand-in built
 * only where a learner needs to *see* the pattern, e.g. ReviewPage's
 * `pitch_accent` card reveal).
 *
 * A trailing hollow node shows the following-particle pitch: it stays high
 * only for heiban, so it's what visually separates heiban from odaka —
 * identical within the word's own span (see `pitchAccentShape.ts` module
 * doc). Rendered from the same `expectedPitchShape` the scoring path uses,
 * so the picture can't drift from the grader.
 */
export function PitchAccentDiagram({
  reading,
  position,
  className,
}: {
  reading: string;
  /** Dictionary accent nucleus: 0 = heiban, 1 = atamadaka, N = drop after mora N. */
  position: number;
  className?: string;
}) {
  const titleId = useId();
  const morae = segmentIntoMorae(reading).map((unit) => unit.text);
  const moraCount = morae.length;
  if (moraCount === 0) return null;

  const shape = expectedPitchShape(moraCount, position);
  const particleHigh = position <= 0;
  const pattern = pitchPatternLabel(position, moraCount);

  // Geometry: one column per mora plus one for the trailing particle.
  const columns = moraCount + 1;
  const colWidth = 30;
  const highY = 8;
  const lowY = 30;
  const width = columns * colWidth;
  const height = 44;
  const x = (col: number) => col * colWidth + colWidth / 2;
  const y = (high: boolean) => (high ? highY : lowY);

  const moraPoints = shape.map((cls, index) => ({ cx: x(index), cy: y(cls === 'h') }));
  const particlePoint = { cx: x(moraCount), cy: y(particleHigh) };
  const linePoints = [...moraPoints, particlePoint].map((p) => `${p.cx},${p.cy}`).join(' ');

  const contourWords = [
    ...shape.map((cls) => (cls === 'h' ? 'high' : 'low')),
    `then a particle stays ${particleHigh ? 'high' : 'low'}`,
  ].join(', ');

  return (
    <svg
      className={className ? `pitch-diagram ${className}` : 'pitch-diagram'}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-labelledby={titleId}
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={titleId}>{`${pattern} — ${contourWords}`}</title>
      <polyline points={linePoints} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {moraPoints.map((p, index) => (
        <circle key={index} cx={p.cx} cy={p.cy} r={4} fill="var(--accent)" />
      ))}
      <circle
        cx={particlePoint.cx}
        cy={particlePoint.cy}
        r={3.5}
        fill="var(--bg-elevated)"
        stroke="var(--text-muted)"
        strokeWidth={1.5}
      />
      {morae.map((mora, index) => (
        <text
          key={index}
          x={x(index)}
          y={height - 2}
          textAnchor="middle"
          className="pitch-diagram-label"
        >
          {mora}
        </text>
      ))}
    </svg>
  );
}
