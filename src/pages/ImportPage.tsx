import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  commitImport,
  getDb,
  previewShadowingPackageFile,
  previewCsvFile,
} from '../db/repository';
import type { ImportPreview } from '../lib/csvImport';
import type { ImportDestination, InitialOrderMode } from '../domain/types';
import { ShadowingPreviewCard } from '../components/ShadowingPreviewCard';
import { VocabChips } from '../components/VocabChips';
import type { ShadowingImportPreview } from '../lib/shadowingImport';

type ChapterDestination = 'none' | 'existing' | 'new';

export function ImportPage() {
  const navigate = useNavigate();
  const books = useLiveQuery(
    () => getDb().books.filter((book) => !book.archived).toArray(),
    [],
  );
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [shadowingPreview, setShadowingPreview] =
    useState<ShadowingImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destination, setDestination] =
    useState<ImportDestination>('inbox');
  const [bookId, setBookId] = useState('');
  const [newBookTitle, setNewBookTitle] = useState('');
  const [chapterDestination, setChapterDestination] =
    useState<ChapterDestination>('none');
  const [chapterId, setChapterId] = useState('');
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [orderMode, setOrderMode] =
    useState<InitialOrderMode>('first_occurrence');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shadowingBusy, setShadowingBusy] = useState(false);
  const [shadowingError, setShadowingError] = useState('');

  const selectedIds = useMemo(() => [...selected], [selected]);
  const selectedBook = useMemo(
    () => (books ?? []).find((book) => book.id === bookId),
    [books, bookId],
  );
  const bookChapters = useMemo(
    () =>
      [...(selectedBook?.chapters ?? [])].sort(
        (a, b) => a.position - b.position,
      ),
    [selectedBook],
  );

  function resetChapterDestination() {
    setChapterDestination('none');
    setChapterId('');
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const next = await previewCsvFile(file);
      setPreview(next);
      setSelected(new Set(next.drafts.map((item) => item.proposedId)));
      setNewBookTitle(next.batchName);
      setNewChapterTitle(next.batchName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV');
    } finally {
      setBusy(false);
    }
  }

  async function handleShadowingPackage(file: File | null) {
    if (!file) return;
    setShadowingError('');
    setShadowingBusy(true);
    try {
      setShadowingPreview(await previewShadowingPackageFile(file));
    } catch (err) {
      setShadowingPreview(null);
      setShadowingError(
        err instanceof Error
          ? err.message
          : 'Failed to read shadowing project package',
      );
    } finally {
      setShadowingBusy(false);
    }
  }

  const chapterReady =
    chapterDestination === 'none' ||
    (chapterDestination === 'existing' && Boolean(chapterId)) ||
    (chapterDestination === 'new' && Boolean(newChapterTitle.trim()));
  const canImport =
    selectedIds.length > 0 &&
    (destination === 'inbox' ||
      (destination === 'new_book' && chapterReady) ||
      (destination === 'existing_book' && Boolean(bookId) && chapterReady));

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Import</h2>
        <p className="muted" style={{ margin: 0 }}>
          Four ways to bring sentences in — pick one below.
        </p>
      </section>

      <section
        className="stack"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '1rem',
        }}
      >
        <div className="panel stack">
          <h3 style={{ margin: 0 }}>Satori CSV</h3>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            A vocabulary export from Files. Data stays in this browser unless
            you export a backup.
          </p>
          <label>
            CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {busy ? <div className="muted">Parsing…</div> : null}
          {error ? <div style={{ color: 'var(--danger)' }}>{error}</div> : null}
        </div>

        <div className="panel stack">
          <h3 style={{ margin: 0 }}>Shadowing project ZIP</h3>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            A <code>.shadowing.zip</code> package. Creates or refreshes one
            book in the original video order, with native sentence
            recordings. Audio stays in this browser.
          </p>
          <label>
            Shadowing project ZIP
            <input
              type="file"
              accept=".zip,.shadowing.zip,application/zip"
              onChange={(event) =>
                void handleShadowingPackage(event.target.files?.[0] ?? null)
              }
            />
          </label>
          {shadowingBusy ? <div className="muted">Reading package…</div> : null}
          {shadowingError ? (
            <div style={{ color: 'var(--danger)' }}>{shadowingError}</div>
          ) : null}
        </div>

        <div className="panel stack">
          <h3 style={{ margin: 0 }}>YouTube or podcast — quick import</h3>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Paste a YouTube URL or a podcast's RSS feed. One combined prompt
            segments and translates the transcript in a single AI round trip,
            then a quick skim before committing.
          </p>
          <Link to="/import/quick">
            <button type="button" className="primary">
              Start
            </button>
          </Link>
        </div>

        <div className="panel stack">
          <h3 style={{ margin: 0 }}>YouTube or podcast — full wizard</h3>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Same sources, but with separate transcript, sentence-boundary
            (waveform editing), and translation review steps. Use this when a
            source needs closer editing than the quick import's single pass.
          </p>
          <Link to="/import/youtube">
            <button type="button">Start</button>
          </Link>
        </div>

        <div className="panel stack">
          <h3 style={{ margin: 0 }}>NHK Easy News</h3>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Paste an nhkeasier.com feed URL and pick a graded news article —
            furigana-annotated text plus the real NHK narration audio, no
            transcription needed.
          </p>
          <Link to="/import/nhk-easy">
            <button type="button" className="primary">
              Start
            </button>
          </Link>
        </div>
      </section>

      {shadowingPreview ? (
        <section className="panel stack">
          <h3 style={{ margin: 0 }}>Shadowing project preview</h3>
          <ShadowingPreviewCard
            preview={shadowingPreview}
            onImported={(result) => navigate(`/books/${result.bookId}`)}
            onCancel={() => setShadowingPreview(null)}
          />
        </section>
      ) : null}

      {preview ? (
        <>
          <section className="panel stack">
            <h3 style={{ margin: 0 }}>Import preview</h3>
            <label>
              Batch name
              <input
                value={preview.batchName}
                onChange={(event) =>
                  setPreview({ ...preview, batchName: event.target.value })
                }
              />
            </label>
            <ul className="muted" style={{ margin: 0, paddingLeft: '1.2rem' }}>
              <li>Total CSV rows: {preview.counts.totalRows}</li>
              <li>Context occurrences: {preview.counts.contextOccurrences}</li>
              <li>Unique sentences: {preview.counts.uniqueSentences}</li>
              <li>New sentences: {preview.counts.newSentences}</li>
              <li>Existing updated: {preview.counts.updatedSentences}</li>
              <li>
                Exact duplicates ignored: {preview.counts.exactDuplicatesIgnored}
              </li>
              <li>
                New vocabulary associations:{' '}
                {preview.counts.newVocabularyAssociations}
              </li>
              <li>Rows skipped: {preview.counts.rowsSkipped}</li>
              <li>Warnings: {preview.counts.warningCount}</li>
              <li>Conflicts: {preview.counts.conflictCount}</li>
            </ul>
            {preview.warnings.length ? (
              <div className="stack">
                <strong>Warnings</strong>
                {preview.warnings.map((warning, index) => (
                  <div
                    key={`${index}-${warning.message}`}
                    className="status-pill needs_review"
                  >
                    {warning.message}
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="panel stack">
            <h3 style={{ margin: 0 }}>Destination</h3>
            <label>
              Place selected sentences
              <select
                value={destination}
                onChange={(event) => {
                  const next = event.target.value as ImportDestination;
                  setDestination(next);
                  resetChapterDestination();
                  if (next !== 'existing_book') setBookId('');
                }}
              >
                <option value="inbox">Leave in Inbox</option>
                <option value="new_book">Create a new book</option>
                <option value="existing_book">Add to existing book</option>
              </select>
            </label>
            {destination === 'new_book' ? (
              <label>
                New book title
                <input
                  value={newBookTitle}
                  onChange={(event) => setNewBookTitle(event.target.value)}
                />
              </label>
            ) : null}
            {destination === 'existing_book' ? (
              <label>
                Book
                <select
                  value={bookId}
                  onChange={(event) => {
                    setBookId(event.target.value);
                    resetChapterDestination();
                  }}
                >
                  <option value="">Select…</option>
                  {(books ?? []).map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {destination !== 'inbox' ? (
              <>
                <label>
                  Chapter
                  <select
                    value={chapterDestination}
                    onChange={(event) => {
                      const next = event.target.value as ChapterDestination;
                      setChapterDestination(next);
                      if (next !== 'existing') setChapterId('');
                      if (
                        next === 'new' &&
                        !newChapterTitle.trim() &&
                        preview
                      ) {
                        setNewChapterTitle(
                          preview.batchName || newBookTitle || 'Chapter',
                        );
                      }
                    }}
                  >
                    <option value="none">No chapter</option>
                    {destination === 'existing_book' ? (
                      <option
                        value="existing"
                        disabled={!bookId || bookChapters.length === 0}
                      >
                        Existing chapter
                      </option>
                    ) : null}
                    <option value="new">Create new chapter</option>
                  </select>
                </label>
                {chapterDestination === 'existing' ? (
                  <label>
                    Existing chapter
                    <select
                      value={chapterId}
                      onChange={(event) => setChapterId(event.target.value)}
                    >
                      <option value="">Select…</option>
                      {bookChapters.map((chapter) => (
                        <option key={chapter.id} value={chapter.id}>
                          {chapter.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {chapterDestination === 'new' ? (
                  <label>
                    New chapter title
                    <input
                      value={newChapterTitle}
                      onChange={(event) =>
                        setNewChapterTitle(event.target.value)
                      }
                    />
                  </label>
                ) : null}
              </>
            ) : null}
            {destination !== 'inbox' ? (
              <label>
                Initial order
                <select
                  value={orderMode}
                  onChange={(event) =>
                    setOrderMode(event.target.value as InitialOrderMode)
                  }
                >
                  <option value="first_occurrence">First occurrence in CSV</option>
                  <option value="earliest_created">Earliest WhenCreated</option>
                  <option value="latest_created">Latest WhenCreated</option>
                  <option value="japanese">Japanese text</option>
                  <option value="english">English translation</option>
                  <option value="manual">Manual (CSV order)</option>
                </select>
              </label>
            ) : null}
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              Automatic ordering does not reconstruct original Satori article
              order.
              {destination !== 'inbox' && chapterDestination !== 'none'
                ? ' Selected sentences are assigned to the chapter, including any that were already in the book.'
                : null}
            </p>
            <button
              type="button"
              className="primary"
              disabled={!canImport}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await commitImport({
                    preview,
                    selectedIds,
                    destination,
                    bookId: bookId || undefined,
                    newBookTitle,
                    orderMode,
                    chapterId:
                      chapterDestination === 'existing'
                        ? chapterId || undefined
                        : undefined,
                    newChapterTitle:
                      chapterDestination === 'new'
                        ? newChapterTitle.trim()
                        : undefined,
                  });
                  if (result.bookId) navigate(`/books/${result.bookId}`);
                  else navigate('/inbox');
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : 'Import failed',
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Import {selectedIds.length} selected
            </button>
          </section>

          <section className="stack">
            <div className="row">
              <button
                type="button"
                onClick={() =>
                  setSelected(new Set(preview.drafts.map((item) => item.proposedId)))
                }
              >
                Select all
              </button>
              <button type="button" onClick={() => setSelected(new Set())}>
                Select none
              </button>
            </div>
            {preview.drafts.map((item) => (
              <label key={item.proposedId} className="list-card">
                <div className="row">
                  <input
                    type="checkbox"
                    checked={selected.has(item.proposedId)}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(item.proposedId);
                      else next.delete(item.proposedId);
                      setSelected(next);
                    }}
                  />
                  <span className="status-pill">
                    {item.isNew ? 'New' : item.willUpdate ? 'Update' : 'Exists'}
                  </span>
                  {item.draft.conflicts.length ? (
                    <span className="status-pill needs_review">Conflict</span>
                  ) : null}
                </div>
                <div className="jp">{item.draft.japanese}</div>
                <div className="muted">{item.draft.translation}</div>
                <VocabChips items={item.draft.targetVocabulary} />
                {item.draft.conflicts.map((conflict) => (
                  <div key={conflict.field} className="muted">
                    Conflict on {conflict.field}: keeping “{conflict.preferred}”;
                    also saw {conflict.alternatives.join(' / ')}
                  </div>
                ))}
              </label>
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}
