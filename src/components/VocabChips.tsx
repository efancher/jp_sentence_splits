import { useState } from 'react';

import type { TargetVocabulary } from '../domain/types';

export function VocabChips({ items }: { items: TargetVocabulary[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!items.length) return null;
  return (
    <div className="stack" style={{ gap: '0.45rem' }}>
      <div className="row">
        {items.map((item) => {
          const key = `${item.expression}-${item.reading}`;
          const open = openId === key;
          return (
            <button
              key={key}
              type="button"
              className="chip"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : key)}
            >
              <span className="jp">{item.expression}</span>
              {item.reading ? (
                <span className="muted">({item.reading})</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {items.map((item) => {
        const key = `${item.expression}-${item.reading}`;
        if (openId !== key) return null;
        return (
          <div key={`${key}-detail`} className="vocab-drawer panel">
            <div className="jp" style={{ fontSize: '1.25rem' }}>
              {item.furigana || item.expression}
            </div>
            {item.reading ? <div className="muted">{item.reading}</div> : null}
            {item.english ? <div>{item.english}</div> : null}
            {item.partsOfSpeech ? (
              <div className="muted">{item.partsOfSpeech}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
