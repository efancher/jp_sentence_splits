import type { SentenceJourney } from '../lib/sentenceJourney';

function counts(label: string, value: { supported: { done: number; total: number }; independent: { done: number; total: number } }): string {
  if (value.supported.total === 0) return `${label}: not identified yet`;
  return `${label}: ${value.independent.done}/${value.independent.total} independent, ${value.supported.done}/${value.supported.total} with support`;
}

export function SentenceJourneyDetails({ journey }: { journey: SentenceJourney }) {
  if (journey.percent === undefined) return null;
  return (
    <details className="muted" aria-label="Sentence journey">
      <summary>
        Sentence journey: {journey.percent}%{journey.provisional ? ' (provisional)' : ''}
      </summary>
      <ol style={{ margin: '0.25rem 0', paddingLeft: '1.2rem' }}>
        {journey.stages.map((stage) => (
          <li key={stage.id}>
            {stage.label}: {stage.fraction === null ? 'not assessed' : `${Math.round(stage.fraction * 100)}%`} — {stage.note}
          </li>
        ))}
      </ol>
      <div>{counts('Words', journey.vocabulary)}</div>
      <div>{counts('Structure', journey.structure)}</div>
      {journey.provisional ? <div>Provisional: some targets are not identified yet, so this is not a completion measure.</div> : null}
      <div>Expression stages are not built yet, so reading alone cannot reach 100%.</div>
    </details>
  );
}
