import { useMemo } from 'react';

import type { KanaTimelineEntry } from '../lib/kanaTimeline';
import { voicedTimeSpan, type PitchAnalysisPayload } from '../lib/pitch';
import { KanaTimelineRow } from './KanaTimelineRow';

const WIDTH = 320;
const PAD_Y = 5;
/** Half-width of the highlight band around the playhead, in viewBox units. */
const BAND_HALF = 3;

/**
 * The *measured* sentence-level pitch of a clip — a real YIN track (via
 * `extractPitch` / `loadOrComputeReferencePitch`), not a predicted contour.
 * Shown directly under the sentence on the `listening` / `word_listening`
 * review reveals and the shadowing surfaces, complementing the per-word
 * dictionary H/L marks (`SentencePitchAccentRow`) with an honest, model-free
 * sentence-level view. Usually the native reference; on the pitch-accent
 * drill it's the learner's own take (`label` distinguishes them).
 *
 * Drawn in relative semitones against the speaker's own median (so a
 * baritone reference sits centred, same normalization as everywhere else),
 * with the line broken into separate runs across unvoiced gaps so no phantom
 * line spans a silence. Renders nothing when there's no track or too little
 * voiced signal to be meaningful.
 *
 * The x-axis is cropped to the clip's *voiced span* (`voicedTimeSpan`, same
 * helper the shadowing-analysis contours use), not the raw clip — reference
 * clips are usually cut with leading/trailing room tone, and drawing over
 * the whole clip squashes the actual speech into a sliver on the left.
 *
 * `progress` (0..1, fraction of the clip's duration) draws a playhead,
 * remapped into the voiced window; it hides while playback is in the
 * trimmed lead-in/trail.
 *
 * `kana` (from `buildKanaTimeline`, needs a forced alignment) lays the
 * transcript's syllables under the same time axis — same treatment as the
 * shadowing analysis contours.
 */
export function MeasuredPitchContour({
  payload,
  progress,
  label = 'Native pitch (measured)',
  ariaLabel = 'Measured pitch of the native recording',
  kana,
  height = 36,
}: {
  payload?: PitchAnalysisPayload;
  progress?: number | null;
  /** Visible caption; defaults to the native-reference wording. */
  label?: string;
  /** SVG aria-label; defaults to the native-reference wording. */
  ariaLabel?: string;
  /** Time-aligned kana ruler under the contour; omitted when there's no alignment. */
  kana?: KanaTimelineEntry[];
  /** Rendered pixel height; the compact review reveals keep the default, ShadowPage passes a taller one. */
  height?: number;
}) {
  const result = useMemo(() => {
    const frames = payload?.frames ?? [];
    const window = voicedTimeSpan(payload);
    if (!window) return null;
    const voiced = frames.filter(
      (frame) =>
        frame.voiced &&
        frame.relativeSemitones !== null &&
        frame.timeSeconds >= window.start &&
        frame.timeSeconds <= window.end,
    );
    if (voiced.length < 2) return null;
    const values = voiced.map((frame) => frame.relativeSemitones as number);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(0.001, max - min);
    const windowSpan = Math.max(0.001, window.end - window.start);

    const runs: string[] = [];
    let current: string[] = [];
    frames.forEach((frame) => {
      const inWindow =
        frame.timeSeconds >= window.start && frame.timeSeconds <= window.end;
      if (!frame.voiced || frame.relativeSemitones === null || !inWindow) {
        if (current.length >= 2) runs.push(current.join(' '));
        current = [];
        return;
      }
      const x = ((frame.timeSeconds - window.start) / windowSpan) * WIDTH;
      const y =
        height - PAD_Y - ((frame.relativeSemitones - min) / span) * (height - 2 * PAD_Y);
      current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    });
    if (current.length >= 2) runs.push(current.join(' '));
    return runs.length ? { runs, window } : null;
  }, [payload, height]);

  if (!result) return null;
  const { runs: segments, window } = result;

  const clipDuration = payload?.durationSeconds ?? 0;
  const playheadFrac =
    progress != null && progress >= 0 && progress <= 1 && clipDuration > 0
      ? (progress * clipDuration - window.start) / Math.max(0.001, window.end - window.start)
      : null;
  const playheadX =
    playheadFrac != null && playheadFrac >= 0 && playheadFrac <= 1
      ? playheadFrac * WIDTH
      : null;

  return (
    <div className="pitch-contour">
      <span className="muted pitch-contour-caption">{label}</span>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        style={{ width: '100%', height }}
      >
        {playheadX != null ? (
          <>
            <rect
              className="pitch-contour-band"
              x={Math.max(0, playheadX - BAND_HALF)}
              y={0}
              width={Math.min(WIDTH, playheadX + BAND_HALF) - Math.max(0, playheadX - BAND_HALF)}
              height={height}
            />
            <line
              className="pitch-contour-playhead"
              x1={playheadX}
              x2={playheadX}
              y1={0}
              y2={height}
            />
          </>
        ) : null}
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
      {kana && kana.length > 0 ? (
        <KanaTimelineRow entries={kana} label={`${label} syllables`} />
      ) : null}
    </div>
  );
}
