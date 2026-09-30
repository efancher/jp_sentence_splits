import { useMemo, useState } from 'react';

import { createId } from '../lib/ids';

import type { LessonEventInput } from './TargetLessonCard';

export interface MeaningUnit {
  id: string;
  text: string;
}

/** The meaning units an attempt should carry: the chunk glosses, or else the whole translation as one unit. */
export function meaningUnits(chunks: { id: string; literalEnglish?: string }[], translation: string): MeaningUnit[] {
  const units = chunks
    .filter((chunk) => chunk.literalEnglish?.trim())
    .map((chunk) => ({ id: chunk.id, text: chunk.literalEnglish!.trim() }));
  return units.length >= 2 ? units : [{ id: 'whole', text: translation.trim() }];
}

type Phase = 'cue' | 'revealed' | 'recorded';

export function SentenceExpressionCard({
  sentence,
  translation,
  units,
  visitId,
  quietMode,
  onEvent,
  onClose,
}: {
  sentence: { id: string; japanese: string };
  translation: string;
  units: MeaningUnit[];
  visitId: string;
  quietMode: boolean;
  onEvent: (event: LessonEventInput) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('cue');
  const [frame, setFrame] = useState(false);
  const [modality, setModality] = useState<'typed' | 'spoken'>('typed');
  const [answer, setAnswer] = useState('');
  const [carried, setCarried] = useState<Set<string>>(new Set());
  const effectiveModality = quietMode ? 'typed' : modality;
  const missing = useMemo(() => units.filter((unit) => !carried.has(unit.id)), [units, carried]);

  function record() {
    onEvent({
      id: createId('sl_event'),
      visitId,
      action: 'expression_attempt',
      sentenceId: sentence.id,
      outcome: missing.length === 0 ? 'got_it' : 'needed_help',
      assessmentSource: 'self',
      modality: effectiveModality,
      scaffold: frame ? 'frame' : 'none',
      unitsExpressed: units.length - missing.length,
      unitsTotal: units.length,
      learnerAnswer: effectiveModality === 'typed' && answer.trim() ? answer.trim() : undefined,
      quietMode,
    });
    setPhase('recorded');
  }

  return (
    <section className="panel stack" aria-label="Say it in Japanese" style={{ gap: '0.5rem' }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <strong>Say it in Japanese</strong>
        <button type="button" onClick={onClose}>Back to the walkthrough</button>
      </div>
      <div><span className="muted">Meaning: </span>{translation}</div>
      {phase === 'cue' ? (
        <>
          <p className="muted" style={{ margin: 0 }}>
            The Japanese and its glosses are hidden. Say or type your own version. Different wording is fine if it carries the meaning.
          </p>
          {frame ? (
            <ol aria-label="Frame" style={{ margin: 0, paddingLeft: '1.2rem' }}>
              {units.map((unit) => <li key={unit.id}>{unit.text}</li>)}
            </ol>
          ) : (
            <button type="button" onClick={() => setFrame(true)}>Give me a frame (counts as supported)</button>
          )}
          <div className="row" role="radiogroup" aria-label="How will you answer" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
            <label className="row" style={{ gap: '0.3rem' }}>
              <input type="radio" name="expr-modality" checked={effectiveModality === 'typed'} onChange={() => setModality('typed')} />
              Type it
            </label>
            <label className="row" style={{ gap: '0.3rem' }}>
              <input type="radio" name="expr-modality" disabled={quietMode} checked={effectiveModality === 'spoken'} onChange={() => setModality('spoken')} />
              Say it aloud
            </label>
            {quietMode ? <span className="muted">Speaking is off while you can&rsquo;t speak; typing is recorded as written practice.</span> : null}
          </div>
          {effectiveModality === 'typed' ? (
            <textarea rows={2} lang="ja" aria-label="Your Japanese" value={answer} onChange={(event) => setAnswer(event.target.value)} />
          ) : (
            <div className="muted">Say it out loud now, then continue.</div>
          )}
          <button type="button" className="primary" onClick={() => setPhase('revealed')}>Show the model and check</button>
        </>
      ) : (
        <>
          <div><span className="muted">Model: </span><span className="jp jp-lg">{sentence.japanese}</span></div>
          {answer.trim() && effectiveModality === 'typed' ? <div><span className="muted">You wrote: </span><span className="jp">{answer.trim()}</span></div> : null}
          {phase === 'revealed' ? (
            <fieldset className="stack" style={{ gap: '0.2rem', border: 0, padding: 0, margin: 0 }}>
              <legend className="muted">Did your version carry each part of the meaning? Wording can differ from the model.</legend>
              {units.map((unit) => (
                <label key={unit.id} className="row" style={{ gap: '0.4rem', alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={carried.has(unit.id)}
                    onChange={(event) => setCarried((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(unit.id); else next.delete(unit.id);
                      return next;
                    })}
                  />
                  <span>{unit.text}</span>
                </label>
              ))}
              <button type="button" className="primary" onClick={record}>Record my attempt</button>
            </fieldset>
          ) : (
            <div role="status" className="stack" style={{ gap: '0.2rem' }}>
              {missing.length === 0 ? (
                <div>Recorded as carrying the whole meaning{frame ? ', with a frame' : ''}. Your review schedule is unchanged.</div>
              ) : (
                <>
                  <div>Recorded. Still to carry next time:</div>
                  <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>{missing.map((unit) => <li key={unit.id}>{unit.text}</li>)}</ul>
                </>
              )}
              <div className="muted">A self-check, not a grade; it says nothing about any single word or pattern.</div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
