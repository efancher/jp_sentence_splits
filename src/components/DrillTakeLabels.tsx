import type { DrillTakeLabel, DrillTakeLabels } from '../sync/drillTakeRemote';

/**
 * Optional after-take verdict per scored word — "did that feel right?" — kept
 * with the take (`pitch_drill_takes.labels`) so the grader can be judged
 * against the learner's own ear, not only against the dictionary. Appears after
 * the take, never before it, so it can't become a guess gate.
 */
export function DrillTakeLabelsPanel({
  words,
  labels,
  onChange,
}: {
  words: string[];
  labels: DrillTakeLabels;
  onChange: (surfaceForm: string, label: DrillTakeLabel | null) => void;
}) {
  if (words.length === 0) return null;
  return (
    <div className="stack" style={{ gap: '0.3rem' }}>
      <span className="muted" style={{ fontSize: '0.85rem' }}>
        Optional: how did {words.length === 1 ? 'it' : 'each word'} feel? (kept with this take to check the grader)
      </span>
      {words.map((word) => (
        <div key={word} className="row" style={{ gap: '0.4rem', alignItems: 'center' }}>
          <span className="jp">{word}</span>
          {(['right', 'off'] as const).map((label) => (
            <button
              key={label}
              type="button"
              aria-pressed={labels[word] === label}
              className={labels[word] === label ? 'active' : undefined}
              onClick={() => onChange(word, labels[word] === label ? null : label)}
            >
              {label === 'right' ? 'Felt right' : 'Felt off'}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
