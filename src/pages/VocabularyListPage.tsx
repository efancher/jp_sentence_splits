import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { getDb } from '../db/repository';
import { isHanCharacter } from '../lib/kanji';

export function VocabularyListPage() {
  const [query, setQuery] = useState('');
  const items = useLiveQuery(() => getDb().vocabularyItems.toArray(), []);

  const filtered = useMemo(() => {
    const all = [...(items ?? [])].sort((a, b) =>
      a.expression.localeCompare(b.expression, 'ja'),
    );
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (item) =>
        item.expression.includes(query) ||
        item.reading.includes(query) ||
        item.meaning.toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Words</h2>
        <p className="muted" style={{ margin: 0 }}>
          Vocabulary confirmed via the picker on Analyze pages.
        </p>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Expression, reading, or meaning…"
          aria-label="Search vocabulary"
        />
      </section>

      <section className="stack">
        {items === undefined ? (
          <p className="muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="muted">
            {items.length === 0
              ? 'No confirmed vocabulary yet — confirm vocabulary selections on a sentence to see them here.'
              : 'No matching words.'}
          </p>
        ) : (
          filtered.map((item) => (
            <article key={item.id} className="list-card">
              <div className="jp">
                {Array.from(item.expression).map((char, index) =>
                  isHanCharacter(char) ? (
                    <Link key={index} to={`/kanji/${encodeURIComponent(char)}`}>
                      {char}
                    </Link>
                  ) : (
                    <span key={index}>{char}</span>
                  ),
                )}
              </div>
              {item.reading ? <div className="muted">{item.reading}</div> : null}
              <div>{item.meaning || '(no meaning yet)'}</div>
              {item.partOfSpeech ? (
                <div className="muted">{item.partOfSpeech}</div>
              ) : null}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
