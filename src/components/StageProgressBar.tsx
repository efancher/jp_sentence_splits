import {
  SENTENCE_STAGES,
  SENTENCE_STAGE_LABELS,
  type StageCounts,
} from '../lib/sentenceStages';

export function StageProgressBar({
  total,
  counts,
  showLegend = false,
}: {
  total: number;
  counts: StageCounts;
  showLegend?: boolean;
}) {
  if (total === 0) return null;
  return (
    <div className="stage-progress">
      <div
        className="stage-bar"
        role="img"
        aria-label={SENTENCE_STAGES.map(
          (stage) => `${counts[stage]} ${SENTENCE_STAGE_LABELS[stage]}`,
        ).join(', ')}
      >
        {SENTENCE_STAGES.map((stage) =>
          counts[stage] ? (
            <span
              key={stage}
              className={`stage-seg stage-${stage}`}
              style={{ width: `${(counts[stage] / total) * 100}%` }}
              title={`${SENTENCE_STAGE_LABELS[stage]}: ${counts[stage]}`}
            />
          ) : null,
        )}
      </div>
      {showLegend ? (
        <div className="stage-legend muted">
          {SENTENCE_STAGES.map((stage) => (
            <span key={stage}>
              <i className={`stage-dot stage-${stage}`} />
              {SENTENCE_STAGE_LABELS[stage]} {counts[stage]}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
