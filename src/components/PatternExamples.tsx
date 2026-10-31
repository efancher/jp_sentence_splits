import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { GrammarEncounter } from '../db/repository';
import { formsSeen, lineUpExamples } from '../lib/grammarExamples';

/** Fewer than this and there is nothing to compare, so the section stays hidden. */
const MIN_EXAMPLES = 2;

/**
 * The pattern in your own sentences, side by side: the words that make up the pattern are highlighted (and, on a wide
 * screen, lined up in one column), simplest sentence first, so the part that stays the same stands out from the part
 * that changes. Only encounters with a span take part; the full list below still shows every encounter.
 */
export function PatternExamples({ encounters }: { encounters: readonly GrammarEncounter[] }) {
  const [form, setForm] = useState<string | null>(null);
  const examples = useMemo(() => lineUpExamples(encounters), [encounters]);
  const forms = useMemo(() => formsSeen(examples), [examples]);
  if (examples.length < MIN_EXAMPLES) return null;
  const shown = form ? examples.filter((example) => example.parts.match === form) : examples;
  // One shared width (in em, a Japanese character is 1em) keeps every highlight starting at the same x on a wide screen.
  const matchWidth = `${Math.max(...shown.map(({ parts }) => parts.match.length)) + 0.4}em`;
  return (
    <section className="stack" aria-label="Lined up examples" style={{ '--kwic-match': matchWidth } as React.CSSProperties}>
      <h3 style={{ margin: 0 }}>Lined up ({examples.length})</h3>
      <p className="muted" style={{ margin: 0 }}>
        Your sentences with this pattern highlighted, simplest first. What stays the same is the pattern.
      </p>
      {forms.length > 1 ? (
        <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }} aria-label="Forms you have met">
          <span className="muted">Forms you have met:</span>
          {forms.map((item) => (
            <button
              key={item.form}
              type="button"
              className="jp"
              aria-pressed={form === item.form}
              onClick={() => setForm(form === item.form ? null : item.form)}
            >
              {item.form} ({item.count})
            </button>
          ))}
        </div>
      ) : null}
      {shown.map(({ item, parts }) => {
        const book = item.books[0];
        const row = (
          <div className="kwic-row jp">
            <span className="kwic-before">{parts.before}</span>
            <mark>{parts.match}</mark>
            <span className="kwic-after">{parts.after}</span>
          </div>
        );
        return (
          <div key={item.sentenceGrammar.id} className="stack" style={{ gap: '0.1rem' }}>
            {book ? <Link to={`/books/${book.id}/analyze/${item.sentence.id}`}>{row}</Link> : row}
            {item.sentence.translation ? <div className="muted">{item.sentence.translation}</div> : null}
            {item.sentenceGrammar.occurrenceExplanation ? (
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                {item.sentenceGrammar.occurrenceExplanation}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
