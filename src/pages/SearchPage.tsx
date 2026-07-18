import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';

import { getDb, searchAll } from '../db/repository';

type FilterKey =
  | 'all'
  | 'unassigned'
  | 'unstarted'
  | 'in_progress'
  | 'complete'
  | 'needs_review'
  | 'has_warning'
  | 'multi_vocab'
  | 'missing_translation'
  | 'missing_analysis';

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const results = useLiveQuery(() => searchAll(query), [query]);
  const meta = useLiveQuery(async () => {
    const db = getDb();
    return {
      inbox: await db.inbox.toArray(),
      bookSentences: await db.bookSentences.toArray(),
      analyses: await db.analyses.toArray(),
      sentences: await db.sentences.toArray(),
    };
  }, []);

  const filteredSentences = useMemo(() => {
    const sentences = results?.sentences ?? meta?.sentences ?? [];
    const inboxIds = new Set((meta?.inbox ?? []).map((item) => item.sentenceId));
    const analysisById = new Map(
      (meta?.analyses ?? []).map((item) => [item.sentenceId, item]),
    );
    const statuses = new Map<string, string>();
    for (const item of meta?.bookSentences ?? []) {
      statuses.set(item.sentenceId, item.status);
    }

    return sentences.filter((sentence) => {
      if (query && !(results?.sentences ?? []).some((item) => item.id === sentence.id)) {
        // When querying, prefer search results; when empty query show all with filters.
      }
      switch (filter) {
        case 'unassigned':
          return inboxIds.has(sentence.id);
        case 'unstarted':
          return (statuses.get(sentence.id) ?? 'unstarted') === 'unstarted';
        case 'in_progress':
          return statuses.get(sentence.id) === 'in_progress';
        case 'complete':
          return statuses.get(sentence.id) === 'complete';
        case 'needs_review':
          return statuses.get(sentence.id) === 'needs_review';
        case 'has_warning':
          return sentence.conflicts.length > 0;
        case 'multi_vocab':
          return sentence.targetVocabulary.length > 1;
        case 'missing_translation':
          return !sentence.translation;
        case 'missing_analysis':
          return !analysisById.get(sentence.id)?.chunks.length;
        default:
          return true;
      }
    });
  }, [filter, meta, query, results]);

  const books = query ? results?.books ?? [] : [];

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Search</h2>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Japanese, English, vocab, book title…"
          aria-label="Search"
        />
        <label>
          Filter
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as FilterKey)}
          >
            <option value="all">All</option>
            <option value="unassigned">Unassigned</option>
            <option value="unstarted">Unstarted</option>
            <option value="in_progress">In progress</option>
            <option value="complete">Complete</option>
            <option value="needs_review">Needs review</option>
            <option value="has_warning">Has import warning</option>
            <option value="multi_vocab">Multiple target vocabulary</option>
            <option value="missing_translation">Missing Satori translation</option>
            <option value="missing_analysis">Missing analysis</option>
          </select>
        </label>
      </section>

      {books.length ? (
        <section className="stack">
          <h3 style={{ margin: 0 }}>Books</h3>
          {books.map((book) => (
            <Link key={book.id} to={`/books/${book.id}`} className="list-card">
              <strong>{book.title}</strong>
            </Link>
          ))}
        </section>
      ) : null}

      <section className="stack">
        <h3 style={{ margin: 0 }}>Sentences</h3>
        {filteredSentences.map((sentence) => (
          <article key={sentence.id} className="list-card">
            <div className="jp">{sentence.japanese}</div>
            <div className="muted">{sentence.translation}</div>
          </article>
        ))}
        {!filteredSentences.length ? (
          <p className="muted">No matching sentences.</p>
        ) : null}
      </section>
    </div>
  );
}
