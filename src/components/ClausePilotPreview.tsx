import { useState } from 'react';
import { clausePilotFeedbackKey, clauseQuestionAvailability, uniqueTextSpan, type ClausePilotFeedback, type ClausePilotReference } from '../lib/clausePilot';

export function ClausePilotPreview({ japanese }: { japanese: string }) {
  const availability = clauseQuestionAvailability(japanese);
  if (availability.status === 'ready') {
    return <ClauseQuestion key={availability.reference.id} reference={availability.reference} />;
  }
  return (
    <aside className="panel stack" aria-label="Upgraded question availability">
      <strong>{availability.status === 'reviewed' ? 'Reviewed — no upgraded question yet' : 'Upgraded question not prepared yet'}</strong>
      <p className="muted" style={{ margin: 0 }}>{availability.status === 'reviewed'
        ? availability.reason : 'This sentence does not have an upgraded question for its current wording.'}</p>
      <p className="muted" style={{ margin: 0 }}>You can ask to prepare a question for this sentence later.</p>
    </aside>
  );
}

function ClauseQuestion({ reference }: { reference: ClausePilotReference }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [feedback, setFeedback] = useState<ClausePilotFeedback | null>(() => {
    try {
      const saved = localStorage.getItem(clausePilotFeedbackKey(reference.id));
      return saved === 'helpful' || saved === 'disputed' ? saved : null;
    } catch { return null; }
  });
  const target = uniqueTextSpan(reference.source, reference.targetText)!;
  // Rotate choices deterministically, so the draft answer is not always the first button.
  const pivot = reference.source.length % reference.options.length;
  const options = [...reference.options.slice(pivot), ...reference.options.slice(0, pivot)];
  function recordFeedback(value: ClausePilotFeedback) {
    setFeedback(value);
    try {
      localStorage.setItem(clausePilotFeedbackKey(reference.id), value);
      setStorageError(false);
    } catch { setStorageError(true); }
  }
  return (
    <details className="panel" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Try a clause question (preview)</summary>
      {open ? <div className="stack" style={{ marginTop: '0.75rem' }}>
        <p className="muted">An ungraded draft question. Your choice does not affect reviews or progress.</p>
        <p className="jp" aria-label="Sentence with the target highlighted">
          {reference.source.slice(0, target.start)}<mark>{reference.targetText}</mark>{reference.source.slice(target.end)}
        </p>
        <p>{reference.question}</p>
        <div className="row" role="group" aria-label="Clause answer choices" style={{ flexWrap: 'wrap' }}>
          {options.map((option) => (
            <button key={option} type="button" aria-pressed={choice === option} disabled={revealed}
              onClick={() => setChoice(option)}>{option}</button>
          ))}
        </div>
        {!revealed ? <button type="button" onClick={() => setRevealed(true)}>Show explanation</button> : (
          <div className="stack" role="status">
            {choice ? <p>Your choice: <span className="jp">{choice}</span></p> : null}
            <p>Draft answer: <strong className="jp">{reference.answerText}</strong></p>
            <p>{reference.explanation}</p>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button type="button" aria-pressed={feedback === 'helpful'} onClick={() => recordFeedback('helpful')}>This explanation helped</button>
              <button type="button" aria-pressed={feedback === 'disputed'} onClick={() => recordFeedback('disputed')}>Another answer works</button>
            </div>
            {feedback ? <p className="muted">{storageError ? 'Could not save feedback on this device.' : 'Feedback saved on this device.'}</p> : null}
            <button type="button" onClick={() => { setRevealed(false); setChoice(null); }}>Try again</button>
          </div>
        )}
      </div> : null}
    </details>
  );
}
