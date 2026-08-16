import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { VocabChips } from '../components/VocabChips';
import {
  addSentencesToBook,
  createBook,
  getDb,
  renameImportBatch,
} from '../db/repository';

export function ImportBatchPage() {
  const { batchId = '' } = useParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destinationBookId, setDestinationBookId] = useState('');
  const [newBookTitle, setNewBookTitle] = useState('');
  const [message, setMessage] = useState('');
  const [editingBatchName, setEditingBatchName] = useState(false);
  const [batchNameDraft, setBatchNameDraft] = useState('');

  const data = useLiveQuery(async () => {
    const db = getDb();
    const [batch, books, allSentences] = await Promise.all([
      db.importBatches.get(batchId),
      db.books.filter((book) => !book.archived).toArray(),
      db.sentences.toArray(),
    ]);
    return {
      batch,
      books,
      sentences: allSentences
        .filter((sentence) => sentence.importBatchIds.includes(batchId))
        .sort((a, b) => a.firstOccurrenceIndex - b.firstOccurrenceIndex),
    };
  }, [batchId]);

  if (!data) return <p className="muted">Loading import batch…</p>;
  if (!data.batch) {
    return (
      <div className="empty-state">
        <strong>Import batch not found.</strong>
        <Link to="/inbox">Back to Inbox</Link>
      </div>
    );
  }

  async function addSelected() {
    let bookId = destinationBookId;
    if (destinationBookId === 'new') {
      const book = await createBook({ title: newBookTitle });
      bookId = book.id;
    }
    if (!bookId || !selected.size) return;
    await addSentencesToBook(bookId, [...selected], 'first_occurrence');
    setMessage(`Added ${selected.size} batch sentence(s) to a book.`);
    setSelected(new Set());
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>{data.batch.batchName}</h2>
            <div className="muted">{data.batch.filename}</div>
          </div>
          <Link to="/inbox">
            <button type="button">Back to Inbox</button>
          </Link>
        </div>
        <div className="muted">
          Imported {new Date(data.batch.importedAt).toLocaleString()} ·{' '}
          {data.sentences.length} linked sentences
        </div>
        {editingBatchName ? (
          <form
            className="row"
            onSubmit={async (event) => {
              event.preventDefault();
              const name = batchNameDraft.trim();
              if (name) await renameImportBatch(batchId, name);
              setEditingBatchName(false);
            }}
          >
            <input
              autoFocus
              value={batchNameDraft}
              onChange={(event) => setBatchNameDraft(event.target.value)}
              aria-label="Import batch name"
            />
            <button type="submit">Save</button>
            <button
              type="button"
              onClick={() => setEditingBatchName(false)}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setBatchNameDraft(data.batch?.batchName ?? '');
              setEditingBatchName(true);
            }}
          >
            Rename batch
          </button>
        )}
        {data.batch.warnings.length ? (
          <details>
            <summary>{data.batch.warnings.length} import warning(s)</summary>
            <ul>
              {data.batch.warnings.map((warning, index) => (
                <li key={`${index}-${warning}`}>{warning}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Sentences in this batch</h3>
          <div className="row">
            <button
              type="button"
              onClick={() =>
                setSelected(
                  new Set(data.sentences.map((sentence) => sentence.id)),
                )
              }
            >
              Select all
            </button>
            <button type="button" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        </div>
        {selected.size ? (
          <div className="panel stack">
            <strong>{selected.size} selected</strong>
            <label>
              Add to book
              <select
                value={destinationBookId}
                onChange={(event) => setDestinationBookId(event.target.value)}
              >
                <option value="">Choose a book…</option>
                <option value="new">Create a new book…</option>
                {data.books.map((book) => (
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
            <button
              type="button"
              className="primary"
              disabled={
                !destinationBookId ||
                (destinationBookId === 'new' && !newBookTitle.trim())
              }
              onClick={() => void addSelected()}
            >
              Add selected
            </button>
          </div>
        ) : null}
        {message ? <div className="status-pill complete">{message}</div> : null}
        {data.sentences.map((sentence) => (
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
              Select sentence
            </label>
            <div className="jp">{sentence.japanese}</div>
            <div className="muted">{sentence.translation}</div>
            <VocabChips items={sentence.targetVocabulary} />
          </article>
        ))}
      </section>
    </div>
  );
}
