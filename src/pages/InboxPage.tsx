import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';

import { getDb } from '../db/repository';
import { VocabChips } from '../components/VocabChips';

export function InboxPage() {
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

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Inbox</h2>
        <p className="muted" style={{ margin: 0 }}>
          Newly imported sentences land here until you add them to a book.
        </p>
      </section>

      <section className="stack">
        <h3 style={{ margin: 0 }}>Unassigned sentences</h3>
        {(items ?? []).map(({ sentence }) =>
          sentence ? (
            <article key={sentence.id} className="list-card">
              <div className="jp">{sentence.japanese}</div>
              <div className="muted">{sentence.translation}</div>
              <VocabChips items={sentence.targetVocabulary} />
              {sentence.conflicts.length ? (
                <div className="status-pill needs_review">Has import conflict</div>
              ) : null}
            </article>
          ) : null,
        )}
        {!items?.length ? <p className="muted">Inbox is empty.</p> : null}
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
