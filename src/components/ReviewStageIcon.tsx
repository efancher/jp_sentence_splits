import type { FsrsState } from '../domain/types';

const STAGES: Record<FsrsState['state'], { glyph: string; label: string }> = {
  new: { glyph: '✦', label: 'New card — first time seeing it' },
  learning: { glyph: '◔', label: 'Learning — still in short-interval steps' },
  review: { glyph: '●', label: 'Review — in long-term rotation' },
  relearning: { glyph: '↻', label: 'Relearning — lapsed, being rebuilt' },
};

export function ReviewStageIcon({ state }: { state: FsrsState['state'] }) {
  const stage = STAGES[state];
  return (
    <span role="img" aria-label={stage.label} title={stage.label}>
      {stage.glyph}
    </span>
  );
}
