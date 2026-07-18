import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';

import {
  createBook,
  getBookProgress,
  getDb,
} from '../db/repository';

export function BooksPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const books = useLiveQuery(async () => {
    const db = getDb();
    const all = await db.books.toArray();
    const withProgress = await Promise.all(
      all.map(async (book) => ({
        book,
        progress: await getBookProgress(book.id),
      })),
    );
    return withProgress.sort((a, b) => {
      if (a.book.archived !== b.book.archived) {
        return a.book.archived ? 1 : -1;
      }
      return (b.book.lastOpenedAt ?? b.book.updatedAt).localeCompare(
        a.book.lastOpenedAt ?? a.book.updatedAt,
      );
    });
  }, []);

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Books</h2>
        <p className="muted" style={{ margin: 0 }}>
          Organize imported sentences into named study books. Analysis stays with
          each sentence, not the book.
        </p>
        <form
          className="row"
          onSubmit={async (event) => {
            event.preventDefault();
            const book = await createBook({ title });
            setTitle('');
            navigate(`/books/${book.id}`);
          }}
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="New book title"
            aria-label="New book title"
          />
          <button type="submit" className="primary">
            Create
          </button>
        </form>
      </section>

      <section className="stack">
        {(books ?? []).map(({ book, progress }) => (
          <article key={book.id} className="list-card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{book.title}</strong>
              {book.archived ? (
                <span className="status-pill">Archived</span>
              ) : null}
            </div>
            {book.subtitle ? <div className="muted">{book.subtitle}</div> : null}
            <div className="muted">
              {progress.complete}/{progress.total} complete · {progress.percent}%
            </div>
            <div className="progress-bar" aria-hidden="true">
              <span style={{ width: `${progress.percent}%` }} />
            </div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              Last opened:{' '}
              {book.lastOpenedAt
                ? new Date(book.lastOpenedAt).toLocaleString()
                : 'Never'}
            </div>
            <div className="row">
              <Link to={`/books/${book.id}`}>
                <button type="button" className="primary">
                  Open
                </button>
              </Link>
              <Link to={`/books/${book.id}/practice`}>
                <button type="button">Resume / Practice</button>
              </Link>
            </div>
          </article>
        ))}
        {!books?.length ? (
          <div className="empty-state">
            <strong>Start with your Satori vocabulary export.</strong>
            <span className="muted">
              Importing finds every sentence context, merges duplicate JE/EJ
              cards, and lets you create your first book.
            </span>
            <Link to="/import">
              <button type="button" className="primary">
                Import Satori CSV
              </button>
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}
