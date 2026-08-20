import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { listGrammarPatternSummaries } from '../db/repository';

export function GrammarListPage() {
  const [query, setQuery] = useState('');
  const summaries = useLiveQuery(() => listGrammarPatternSummaries(), []);

  const filtered = useMemo(() => {
    const all = [...(summaries ?? [])].sort(
      (a, b) => b.encounterCount - a.encounterCount,
    );
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      ({ pattern }) =>
        pattern.canonicalName.includes(query) ||
        pattern.aliases.some((alias) => alias.includes(query)) ||
        pattern.shortMeaning.toLowerCase().includes(q) ||
        (pattern.family ?? '').toLowerCase().includes(q),
    );
  }, [summaries, query]);

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Grammar</h2>
        <p className="muted" style={{ margin: 0 }}>
          Constructions noticed and tagged from your own sentences — not a
          fixed syllabus. Tag a pattern from the "Grammar noticed" panel on
          any Analyze page to see it here.
        </p>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, meaning, or family…"
          aria-label="Search grammar patterns"
        />
      </section>

      <section className="stack">
        {summaries === undefined ? (
          <p className="muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="muted">
            {summaries.length === 0
              ? 'No grammar patterns tagged yet — tag one from the "Grammar noticed" panel on an Analyze page.'
              : 'No matching patterns.'}
          </p>
        ) : (
          filtered.map(({ pattern, encounterCount, tracked }) => (
            <Link
              key={pattern.id}
              to={`/grammar/${encodeURIComponent(pattern.id)}`}
              className="list-card"
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong className="jp">{pattern.canonicalName}</strong>
                {tracked ? <span className="status-pill">Tracked</span> : null}
              </div>
              {pattern.shortMeaning ? (
                <div className="muted">{pattern.shortMeaning}</div>
              ) : null}
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                {encounterCount} encounter{encounterCount === 1 ? '' : 's'}
                {pattern.family ? ` · ${pattern.family}` : ''}
              </div>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
