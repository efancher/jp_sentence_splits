import type { KanaTimelineEntry } from '../lib/kanaTimeline';

/**
 * Kana lined up under a pitch contour's linear time axis, so it's clear which
 * syllables the rises and falls belong to. Used on the shadowing analysis
 * contours (`AnalysisPanel`) and the pitch-accent drill's own-recording
 * contour. Only renders once server forced alignment produced entries;
 * degrades to nothing otherwise.
 */
export function KanaTimelineRow({
  entries,
  label,
}: {
  entries: KanaTimelineEntry[];
  label: string;
}) {
  if (entries.length === 0) return null;
  return (
    <div
      aria-label={label}
      style={{ position: 'relative', width: '100%', height: '1.4em', marginTop: 2 }}
    >
      {entries.map((entry, index) => (
        <span
          key={`${entry.text}-${index}`}
          className="jp"
          title={entry.text}
          style={{
            position: 'absolute',
            left: `${entry.leftPct}%`,
            width: `${Math.min(entry.widthPct, 100 - entry.leftPct)}%`,
            textAlign: 'center',
            fontSize: '0.72em',
            lineHeight: 1.3,
            color: 'var(--text-muted)',
            borderLeft: '1px solid var(--border)',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'clip',
          }}
        >
          {entry.text}
        </span>
      ))}
    </div>
  );
}
