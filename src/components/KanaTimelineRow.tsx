import type { KanaTimelineEntry } from '../lib/kanaTimeline';

/**
 * Kana lined up under a pitch contour's linear time axis, so it's clear which
 * syllables the rises and falls belong to. Used on the shadowing analysis
 * contours (`AnalysisPanel`) and the pitch-accent drill's own-recording
 * contour. Only renders once server forced alignment produced entries;
 * degrades to nothing otherwise.
 *
 * A marker whose position is a proportional guess rather than this mora's
 * own measured phone boundary (`entry.exact === false` — common on a
 * learner's own take, since a mispronunciation or hesitation is more likely
 * to fail the aligner's phone parse than a clean native clip) gets a dashed
 * underline and lower opacity, with a caption underneath when any appear —
 * so an odd-looking marker reads as "this position is a guess," not as
 * evidence the pitch measurement above it is wrong.
 */
export function KanaTimelineRow({
  entries,
  label,
}: {
  entries: KanaTimelineEntry[];
  label: string;
}) {
  if (entries.length === 0) return null;
  const anyApproximate = entries.some((entry) => !entry.exact);
  return (
    <div className="stack" style={{ gap: 2 }}>
      <div
        aria-label={label}
        style={{ position: 'relative', width: '100%', height: '1.4em', marginTop: 2 }}
      >
        {entries.map((entry, index) => (
          <span
            key={`${entry.text}-${index}`}
            className="jp"
            title={entry.exact ? entry.text : `${entry.text} (estimated position)`}
            style={{
              position: 'absolute',
              left: `${entry.leftPct}%`,
              width: `${Math.min(entry.widthPct, 100 - entry.leftPct)}%`,
              textAlign: 'center',
              fontSize: '0.72em',
              lineHeight: 1.3,
              color: 'var(--text-muted)',
              opacity: entry.exact ? 1 : 0.6,
              borderLeft: `1px ${entry.exact ? 'solid' : 'dashed'} var(--border)`,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'clip',
            }}
          >
            {entry.text}
          </span>
        ))}
      </div>
      {anyApproximate ? (
        <span className="muted" style={{ fontSize: '0.7em' }}>
          Faint, dashed markers are estimated positions, not measured — the pitch line above is unaffected.
        </span>
      ) : null}
    </div>
  );
}
