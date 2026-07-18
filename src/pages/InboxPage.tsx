import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import {
  addSentencesToBook,
  createBook,
  getDb,
} from '../db/repository';
import { VocabChips } from '../components/VocabChips';

export function InboxPage() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destinationBookId, setDestinationBookId] = useState('');
  const [newBookTitle, setNewBookTitle] = useState('');
  const [message, setMessage] = useState('');

  const items = useLiveQuery(async () => {
    const db = getDb();
    const inbox = await db.inbox.toArray();
    const sentences = await db.sentences.bulkGet(
      inbox.map((item) => item.sentenceId),
    );
    return inbox
      .map((entry, index) => ({
        entry,
        sentence: sentences[index],
      }))
      .filter((item) => item.sentence);
  }, []);

  const batches = useLiveQuery(() => getDb().importBatches.orderBy('importedAt').reverse().toArray(), []);
  const books = useLiveQuery(
    () => getDb().books.filter((book) => !book.archived).toArray(),
    [],
  );

  async function assignSelected() {
    if (!selected.size) return;
    let bookId = destinationBookId;
    if (destinationBookId === 'new') {
      const book = await createBook({ title: newBookTitle });
      bookId = book.id;
    }
    if (!bookId) return;
    await addSentencesToBook(bookId, [...selected], 'first_occurrence');
    setMessage(`Added ${selected.size} sentence(s) to a book.`);
    setSelected(new Set());
    setNewBookTitle('');
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Inbox</h2>
        <p className="muted" style={{ margin: 0 }}>
          Newly imported sentences land here until you add them to a book.
        </p>
      </section>

      <section className="stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Unassigned sentences</h3>
          {items?.length ? (
            <div className="row">
              <button
                type="button"
                onClick={() =>
                  setSelected(
                    new Set(
                      items
                        .map((item) => item.sentence?.id)
                        .filter((id): id is string => Boolean(id)),
                    ),
                  )
                }
              >
                Select all
              </button>
              <button type="button" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          ) : null}
        </div>
        {selected.size ? (
          <div className="panel stack">
            <strong>Assign {selected.size} selected</strong>
            <label>
              Destination book
              <select
                value={destinationBookId}
                onChange={(event) => setDestinationBookId(event.target.value)}
              >
                <option value="">Choose a book…</option>
                <option value="new">Create a new book…</option>
                {(books ?? []).map((book) => (
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
                  placeholder="Book title"
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
              onClick={() => void assignSelected()}
            >
              Add to book
            </button>
          </div>
        ) : null}
        {message ? <div className="status-pill complete">{message}</div> : null}
        {(items ?? []).map(({ sentence }) =>
          sentence ? (
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
              {sentence.conflicts.length ? (
                <div className="status-pill needs_review">Has import conflict</div>
              ) : null}
            </article>
          ) : null,
        )}
        {!items?.length ? (
          <div className="empty-state">
            <strong>Your Inbox is clear.</strong>
            <span className="muted">
              Import a Satori CSV and choose “Leave in Inbox” to organize
              sentences here.
            </span>
            <Link to="/import">
              <button type="button" className="primary">
                Import sentences
              </button>
            </Link>
          </div>
        ) : null}
      </section>

      <section className="stack">
        <h3 style={{ margin: 0 }}>Import batches</h3>
        {(batches ?? []).map((batch) => (
          <article key={batch.id} className="list-card">
            <strong>{batch.batchName}</strong>
            <div className="muted">{batch.filename}</div>
            <div className="muted">
              {new Date(batch.importedAt).toLocaleString()} ·{' '}
              {batch.counts.uniqueSentences} sentences ·{' '}
              {batch.counts.newSentences} new
            </div>
            <Link to="/import">
              <button type="button">Import again</button>
            </Link>
          </article>
        ))}
      </section>
    </div>
  );
}
