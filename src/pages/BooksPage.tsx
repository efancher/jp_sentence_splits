import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';

import {
  createBook,
  getBookProgress,
  getBookVocabularyCoverage,
  getDb,
} from '../db/repository';
import { coveragePercent } from '../lib/bookCoverage';
import { isBookInStudyRotation } from '../lib/suspendedBooks';

type SortMode = 'recent' | 'easiest';

export function BooksPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const books = useLiveQuery(async () => {
    const db = getDb();
    const [all, coverageByBookId] = await Promise.all([
      db.books.toArray(),
      getBookVocabularyCoverage(),
    ]);
    const withProgress = await Promise.all(
      all.map(async (book) => ({
        book,
        progress: await getBookProgress(book.id),
        coverage: coverageByBookId.get(book.id) ?? null,
      })),
    );
    if (sortMode === 'easiest') {
      // Not-yet-analyzed books (null ratio) sort last — there's nothing to
      // call "easy" or "hard" about a book with no confirmed vocabulary yet.
      return withProgress.sort((a, b) => {
        const aRatio = a.coverage?.ratio;
        const bRatio = b.coverage?.ratio;
        if (aRatio == null && bRatio == null) return 0;
        if (aRatio == null) return 1;
        if (bRatio == null) return -1;
        return bRatio - aRatio;
      });
    }
    return withProgress.sort((a, b) => {
      const aActive = isBookInStudyRotation(a.book);
      const bActive = isBookInStudyRotation(b.book);
      if (aActive !== bActive) {
        return aActive ? -1 : 1;
      }
      return (b.book.lastOpenedAt ?? b.book.updatedAt).localeCompare(
        a.book.lastOpenedAt ?? a.book.updatedAt,
      );
    });
  }, [sortMode]);

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

      <section className="row" style={{ justifyContent: 'flex-end', gap: '0.4rem' }}>
        <span className="muted" style={{ fontSize: '0.85rem' }}>Sort:</span>
        <button
          type="button"
          className={sortMode === 'recent' ? 'primary' : undefined}
          onClick={() => setSortMode('recent')}
        >
          Recent
        </button>
        <button
          type="button"
          className={sortMode === 'easiest' ? 'primary' : undefined}
          onClick={() => setSortMode('easiest')}
        >
          Easiest first
        </button>
      </section>

      <section className="stack">
        {(books ?? []).map(({ book, progress, coverage }) => {
          const percent = coverage ? coveragePercent(coverage) : null;
          return (
            <article key={book.id} className="list-card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{book.title}</strong>
                {book.suspendedAt ? (
                  <span className="status-pill">Suspended</span>
                ) : book.archived ? (
                  <span className="status-pill">Archived</span>
                ) : book.chapters?.some((chapter) => chapter.suspendedAt) ? (
                  <span className="status-pill">Chapter suspended</span>
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
                {percent === null
                  ? 'Vocabulary not confirmed yet'
                  : `~${percent}% known vocabulary (${coverage!.knownCount}/${coverage!.totalCount} words)`}
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
                <Link to={`/books/${book.id}/build`}>
                  <button type="button">Build</button>
                </Link>
              </div>
            </article>
          );
        })}
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
