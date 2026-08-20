import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { listGrammarPatternSummaries, type GrammarPatternSummary } from '../db/repository';
import {
  GRAMMAR_PRIORITY_BUCKET_LABELS,
  GRAMMAR_PRIORITY_BUCKET_ORDER,
} from '../lib/grammarPatterns';

/**
 * Personalized grammar curriculum (design brief §13/§14, grammar-learning
 * system Phase 7): groups tagged patterns by
 * `GrammarPatternSummary.priorityBucket` instead of one flat list, so the
 * page can answer "what am I ready to learn" rather than just "what have I
 * tagged." Priority is explainable (`priorityExplanation`), not an opaque
 * score — deliberately, per §14's own instruction. No JLPT-order curriculum
 * anywhere: native encounter frequency/diversity/evidence is the only
 * input.
 */
export function GrammarListPage() {
  const [query, setQuery] = useState('');
  const summaries = useLiveQuery(() => listGrammarPatternSummaries(), []);

  const filtered = useMemo(() => {
    const all = summaries ?? [];
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

  const sections = useMemo(() => {
    const grouped = new Map<string, GrammarPatternSummary[]>();
    for (const summary of filtered) {
      const list = grouped.get(summary.priorityBucket);
      if (list) list.push(summary);
      else grouped.set(summary.priorityBucket, [summary]);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => b.encounterCount - a.encounterCount);
    }
    return GRAMMAR_PRIORITY_BUCKET_ORDER.map((bucket) => ({
      bucket,
      label: GRAMMAR_PRIORITY_BUCKET_LABELS[bucket],
      summaries: grouped.get(bucket) ?? [],
    })).filter((section) => section.summaries.length > 0);
  }, [filtered]);

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

      {summaries === undefined ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">
          {summaries.length === 0
            ? 'No grammar patterns tagged yet — tag one from the "Grammar noticed" panel on an Analyze page.'
            : 'No matching patterns.'}
        </p>
      ) : (
        sections.map((section) => (
          <section key={section.bucket} className="stack">
            <h3 style={{ margin: 0 }}>{section.label}</h3>
            {section.summaries.map(
              ({ pattern, tracked, priorityExplanation }) => (
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
                    {priorityExplanation}
                    {pattern.family ? ` · ${pattern.family}` : ''}
                  </div>
                </Link>
              ),
            )}
          </section>
        ))
      )}
    </div>
  );
}
