import { useMemo } from 'react';

import type { PitchAnalysisPayload } from '../lib/pitch';

const WIDTH = 320;
const HEIGHT = 36;
const PAD_Y = 5;

/**
 * The *measured* sentence-level pitch of a native reference clip — a real YIN
 * track (via `extractPitch` / `loadOrComputeReferencePitch`), not a predicted
 * contour. Shown under the sentence on the `listening` / `word_listening`
 * review reveals and the shadowing surfaces, complementing the per-word
 * dictionary H/L marks (`SentencePitchAccentRow`) with an honest,
 * model-free sentence-level view.
 *
 * Drawn in relative semitones against the speaker's own median (so a
 * baritone reference sits centred, same normalization as everywhere else),
 * with the line broken into separate runs across unvoiced gaps so no phantom
 * line spans a silence. Renders nothing when there's no track or too little
 * voiced signal to be meaningful.
 */
export function MeasuredPitchContour({ payload }: { payload?: PitchAnalysisPayload }) {
  const segments = useMemo(() => {
    const frames = payload?.frames ?? [];
    const voiced = frames.filter(
      (frame) => frame.voiced && frame.relativeSemitones !== null,
    );
    if (voiced.length < 2) return null;
    const values = voiced.map((frame) => frame.relativeSemitones as number);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(0.001, max - min);
    const lastIndex = Math.max(1, frames.length - 1);

    const runs: string[] = [];
    let current: string[] = [];
    frames.forEach((frame, index) => {
      if (!frame.voiced || frame.relativeSemitones === null) {
        if (current.length >= 2) runs.push(current.join(' '));
        current = [];
        return;
      }
      const x = (index / lastIndex) * WIDTH;
      const y =
        HEIGHT - PAD_Y - ((frame.relativeSemitones - min) / span) * (HEIGHT - 2 * PAD_Y);
      current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    });
    if (current.length >= 2) runs.push(current.join(' '));
    return runs.length ? runs : null;
  }, [payload]);

  if (!segments) return null;

  return (
    <div className="pitch-contour">
      <span className="muted pitch-contour-caption">Native pitch (measured)</span>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Measured pitch of the native recording"
        style={{ width: '100%', height: HEIGHT }}
      >
        {segments.map((points, index) => (
          <polyline
            key={index}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />
        ))}
      </svg>
    </div>
  );
}
