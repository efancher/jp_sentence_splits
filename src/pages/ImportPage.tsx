import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  commitShadowingPackageImport,
  commitImport,
  getDb,
  previewShadowingPackageFile,
  previewCsvFile,
} from '../db/repository';
import type { ImportPreview } from '../lib/csvImport';
import type { ImportDestination, InitialOrderMode } from '../domain/types';
import { VocabChips } from '../components/VocabChips';
import type { ShadowingImportPreview } from '../lib/shadowingImport';

const BYTES_PER_MEBIBYTE = 1024 * 1024;

function formatAudioSize(bytes: number): string {
  return `${(bytes / BYTES_PER_MEBIBYTE).toFixed(1)} MB`;
}

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
  const [orderMode, setOrderMode] =
    useState<InitialOrderMode>('first_occurrence');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shadowingBusy, setShadowingBusy] = useState(false);
  const [shadowingError, setShadowingError] = useState('');

  const selectedIds = useMemo(() => [...selected], [selected]);

  async function handleFile(file: File | null) {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const next = await previewCsvFile(file);
      setPreview(next);
      setSelected(new Set(next.drafts.map((item) => item.proposedId)));
      setNewBookTitle(next.batchName);
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

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Import shadowing project</h2>
        <p className="muted" style={{ margin: 0 }}>
          Choose a <code>.shadowing.zip</code>. Glossbook creates or refreshes
          one book in the original video order and imports its native sentence
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
        {shadowingPreview ? (
          <div className="stack">
            <div>
              <strong>{shadowingPreview.source.title}</strong>
              {shadowingPreview.source.channel ? (
                <span className="muted">
                  {' '}
                  · {shadowingPreview.source.channel}
                </span>
              ) : null}
            </div>
            <ul className="muted" style={{ margin: 0, paddingLeft: '1.2rem' }}>
              <li>
                {shadowingPreview.totalRows} video sentence occurrences ·{' '}
                {shadowingPreview.counts.uniqueSentences} unique sentences
              </li>
              <li>
                {shadowingPreview.audioDrafts.length} native audio clips ·{' '}
                {formatAudioSize(shadowingPreview.audioBytes)}
              </li>
              <li>
                {shadowingPreview.counts.newSentences} new ·{' '}
                {shadowingPreview.counts.updatedSentences} updated/existing
              </li>
            </ul>
            {shadowingPreview.warnings.map((warning) => (
              <div
                key={warning.message}
                className="status-pill needs_review"
              >
                {warning.message}
              </div>
            ))}
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              Native clips are not included in Glossbook JSON backups. Keep
              the project ZIP so they can be restored by reimporting it.
            </p>
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={shadowingBusy}
                onClick={async () => {
                  setShadowingBusy(true);
                  try {
                    const result =
                      await commitShadowingPackageImport(shadowingPreview);
                    navigate(`/books/${result.bookId}`);
                  } catch (err) {
                    setShadowingError(
                      err instanceof Error
                        ? err.message
                        : 'Failed to import shadowing project',
                    );
                  } finally {
                    setShadowingBusy(false);
                  }
                }}
              >
                Import complete project
              </button>
              <button
                type="button"
                disabled={shadowingBusy}
                onClick={() => setShadowingPreview(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {shadowingBusy ? (
          <div className="muted">Reading package…</div>
        ) : null}
        {shadowingError ? (
          <div style={{ color: 'var(--danger)' }}>{shadowingError}</div>
        ) : null}
      </section>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Import Satori CSV</h2>
        <p className="muted" style={{ margin: 0 }}>
          Choose a vocabulary export from Files. Data stays in this browser unless
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
      </section>

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
                onChange={(event) =>
                  setDestination(event.target.value as ImportDestination)
                }
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
                  onChange={(event) => setBookId(event.target.value)}
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
            </p>
            <button
              type="button"
              className="primary"
              disabled={
                !selectedIds.length ||
                (destination === 'existing_book' && !bookId)
              }
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
