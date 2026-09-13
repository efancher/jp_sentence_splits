import type { DifficultyScore } from '../lib/miningApi';

/**
 * Rough "looks beginner/intermediate/advanced" readout (see
 * docs/ROADMAP.md, "Podcast mining" item 5) — a screening heuristic, not a
 * calibrated placement test. Shared between the mining wizard's Transcript
 * stage (TranscriptStage.tsx, self-fetched via fetchTranscriptDifficulty)
 * and NHK Easy import (NhkEasyImportPage.tsx, already attached to the
 * import response — no extra fetch there).
 */
export function DifficultyBadge({ score }: { score: DifficultyScore }) {
  if (!score.level) {
    return <span className="muted">Not enough text to score yet.</span>;
  }
  const parts: string[] = [];
  if (score.commonWordRatio != null) {
    parts.push(`${Math.round(score.commonWordRatio * 100)}% common vocabulary`);
  }
  if (score.avgSentenceLength != null) {
    parts.push(`avg ${score.avgSentenceLength.toFixed(1)} words/sentence`);
  }
  if (score.moraePerSecond != null) {
    parts.push(`${score.moraePerSecond.toFixed(1)} morae/sec`);
  }
  return (
    <span className="muted" style={{ fontSize: '0.85rem' }}>
      Looks <strong>{score.level}</strong>
      {parts.length ? ` — ${parts.join(', ')}` : ''}
    </span>
  );
}
