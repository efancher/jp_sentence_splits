import { useState } from 'react';

import type { SentenceAudio } from '../domain/types';
import type { CompareExcerpt } from '../lib/sentenceLearning';
import { NativeAudioButton } from './NativeAudioButton';

/** Optional per-sentence aids for an excerpt; missing pieces are simply not shown. */
export interface CompareAids {
  translation?: string;
  words: { expression: string; reading: string; english: string }[];
  audio?: SentenceAudio;
}

export function Highlighted({ excerpt }: { excerpt: CompareExcerpt }) {
  const { japanese, span } = excerpt;
  if (!span) return <span className="jp">{japanese}</span>;
  return (
    <span className="jp">
      {japanese.slice(0, span.start)}
      <mark>{japanese.slice(span.start, span.end)}</mark>
      {japanese.slice(span.end)}
    </span>
  );
}

export function WordGlossList({ words }: { words: CompareAids['words'] }) {
  if (words.length === 0) return null;
  return (
    <ul className="muted" aria-label="Words in this sentence" style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.85em' }}>
      {words.map((word) => (
        <li key={word.expression}>
          <span className="jp">{word.expression}</span>
          {word.reading && word.reading !== word.expression ? <span className="jp"> ({word.reading})</span> : null} — {word.english}
        </li>
      ))}
    </ul>
  );
}

export function ExcerptWithAids({ excerpt, aids }: { excerpt: CompareExcerpt; aids?: CompareAids }) {
  const [showTranslation, setShowTranslation] = useState(false);
  return (
    <div className="stack" style={{ gap: '0.2rem' }}>
      <Highlighted excerpt={excerpt} />
      {aids ? <WordGlossList words={aids.words} /> : null}
      <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {aids?.audio ? <NativeAudioButton audio={aids.audio} displayLabel="Native audio" hideAdjust /> : null}
        {aids?.translation ? (
          showTranslation ? (
            <span className="muted">{aids.translation}</span>
          ) : (
            <button type="button" onClick={() => setShowTranslation(true)}>Show translation</button>
          )
        ) : null}
      </div>
    </div>
  );
}

