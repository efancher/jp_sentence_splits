import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';

import {
  addSentencesToBook,
  createBook,
  getDb,
  searchAll,
} from '../db/repository';
import { downloadText, formatWorksheetCollection } from '../lib/worksheet';

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destinationBookId, setDestinationBookId] = useState('');
  const [newBookTitle, setNewBookTitle] = useState('');
  const [message, setMessage] = useState('');
  const results = useLiveQuery(() => searchAll(query), [query]);
  const meta = useLiveQuery(async () => {
    const db = getDb();
    return {
      inbox: await db.inbox.toArray(),
      bookSentences: await db.bookSentences.toArray(),
      books: await db.books.toArray(),
      analyses: await db.analyses.toArray(),
      sentences: await db.sentences.toArray(),
    };
  }, []);

  const filteredSentences = useMemo(() => {
    const sentences = query ? (results?.sentences ?? []) : (meta?.sentences ?? []);
    const inboxIds = new Set((meta?.inbox ?? []).map((item) => item.sentenceId));
    const analysisById = new Map(
      (meta?.analyses ?? []).map((item) => [item.sentenceId, item]),
    );
    const statuses = new Map<string, string>();
    for (const item of meta?.bookSentences ?? []) {
      statuses.set(item.sentenceId, item.status);
    }

    return sentences.filter((sentence) => {
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
  const activeBooks = (meta?.books ?? []).filter((book) => !book.archived);

  async function addSelectedToBook() {
    if (!selected.size) return;
    let bookId = destinationBookId;
    if (destinationBookId === 'new') {
      const book = await createBook({ title: newBookTitle });
      bookId = book.id;
    }
    if (!bookId) return;
    await addSentencesToBook(bookId, [...selected], 'first_occurrence');
    setMessage(`Added ${selected.size} result(s) to a book.`);
    setSelected(new Set());
    setNewBookTitle('');
  }

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
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Sentences</h3>
          {filteredSentences.length ? (
            <div className="row">
              <button
                type="button"
                onClick={() =>
                  setSelected(
                    new Set(filteredSentences.map((sentence) => sentence.id)),
                  )
                }
              >
                Select all results
              </button>
              <button type="button" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          ) : null}
        </div>
        {selected.size ? (
          <div className="panel stack">
            <strong>{selected.size} selected result(s)</strong>
            <label>
              Add to book
              <select
                value={destinationBookId}
                onChange={(event) => setDestinationBookId(event.target.value)}
              >
                <option value="">Choose a book…</option>
                <option value="new">Create a new book…</option>
                {activeBooks.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.title}
                  </option>
                ))}
              </select>
            </label>
            {destinationBookId === 'new' ? (
              <label>
                New book title
                <input
                  value={newBookTitle}
                  onChange={(event) => setNewBookTitle(event.target.value)}
                />
              </label>
            ) : null}
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={
                  !destinationBookId ||
                  (destinationBookId === 'new' && !newBookTitle.trim())
                }
                onClick={() => void addSelectedToBook()}
              >
                Add selected
              </button>
              <button
                type="button"
                onClick={() => {
                  const selectedSentences = filteredSentences.filter(
                    (sentence) => selected.has(sentence.id),
                  );
                  const analyses = new Map(
                    (meta?.analyses ?? []).map((analysis) => [
                      analysis.sentenceId,
                      analysis,
                    ]),
                  );
                  downloadText(
                    'satori-glossbook-search-results.txt',
                    formatWorksheetCollection(
                      selectedSentences.map((sentence) => ({
                        sentence,
                        chunks: analyses.get(sentence.id)?.chunks ?? [],
                      })),
                    ),
                    'text/plain',
                  );
                }}
              >
                Export selected
              </button>
            </div>
          </div>
        ) : null}
        {message ? <div className="status-pill complete">{message}</div> : null}
        {filteredSentences.map((sentence) => (
          <article key={sentence.id} className="list-card">
            <label className="selection-control">
              <input
                type="checkbox"
                checked={selected.has(sentence.id)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(sentence.id);
                  else next.delete(sentence.id);
                  setSelected(next);
                }}
              />
              Select result
            </label>
            <div className="jp">{sentence.japanese}</div>
            <div className="muted">{sentence.translation}</div>
            <div className="row">
              {(meta?.bookSentences ?? [])
                .filter((item) => item.sentenceId === sentence.id)
                .sort((a, b) => a.position - b.position)
                .map((membership) => {
                  const book = meta?.books.find(
                    (item) => item.id === membership.bookId,
                  );
                  return (
                    <Link
                      key={membership.id}
                      to={`/books/${membership.bookId}/analyze/${sentence.id}`}
                    >
                      <button type="button">
                        Analyze in {book?.title ?? 'book'}
                      </button>
                    </Link>
                  );
                })}
              {(meta?.inbox ?? []).some(
                (item) => item.sentenceId === sentence.id,
              ) ? (
                <Link to="/inbox">
                  <button type="button">Open in Inbox</button>
                </Link>
              ) : null}
            </div>
          </article>
        ))}
        {!filteredSentences.length ? (
          <p className="muted">No matching sentences.</p>
        ) : null}
      </section>
    </div>
  );
}
