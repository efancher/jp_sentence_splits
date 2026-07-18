import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { VocabChips } from '../components/VocabChips';
import {
  findResumeSentence,
  getDb,
  setBookSentenceStatus,
} from '../db/repository';
import type { StudyStatus } from '../domain/types';
import { summarizeChunks } from '../lib/worksheet';

export function PracticePage() {
  const { bookId = '', sentenceId: routeSentenceId } = useParams();
  const navigate = useNavigate();
  const [reveal, setReveal] = useState({
    chunks: false,
    roles: false,
    lit: false,
    english: false,
  });
  const [attempt, setAttempt] = useState('');

  const data = useLiveQuery(async () => {
    const db = getDb();
    const book = await db.books.get(bookId);
    const memberships = await db.bookSentences
      .where('bookId')
      .equals(bookId)
      .sortBy('position');
    let sentenceId = routeSentenceId;
    if (!sentenceId) {
      sentenceId = (await findResumeSentence(bookId)) ?? undefined;
    }
    if (!sentenceId) return { book, memberships, sentence: null, analysis: null, index: -1, membership: null };
    const index = memberships.findIndex((item) => item.sentenceId === sentenceId);
    const sentence = await db.sentences.get(sentenceId);
    const analysis = await db.analyses.get(sentenceId);
    return {
      book,
      memberships,
      sentence,
      analysis,
      index,
      membership: memberships[index] ?? null,
    };
  }, [bookId, routeSentenceId]);

  const summary = useMemo(
    () => summarizeChunks(data?.analysis?.chunks ?? []),
    [data?.analysis?.chunks],
  );

  if (!data?.book) return <p className="muted">Loading…</p>;
  if (!data.sentence) {
    return (
      <div className="panel stack">
        <p>No sentences in this book.</p>
        <Link to={`/books/${bookId}`}>Back</Link>
      </div>
    );
  }

  const { book, sentence, memberships, index, membership } = data;
  const prev = index > 0 ? memberships[index - 1] : null;
  const next =
    index >= 0 && index < memberships.length - 1 ? memberships[index + 1] : null;

  async function mark(status: StudyStatus) {
    await setBookSentenceStatus(bookId, sentence.id, status);
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="muted">{book.title} · Practice</div>
            <strong>
              {index + 1} of {memberships.length}
            </strong>
          </div>
          <div className="row">
            <button
              type="button"
              disabled={!prev}
              onClick={() => {
                setReveal({
                  chunks: false,
                  roles: false,
                  lit: false,
                  english: false,
                });
                setAttempt('');
                if (prev) navigate(`/books/${bookId}/practice/${prev.sentenceId}`);
              }}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!next}
              onClick={() => {
                setReveal({
                  chunks: false,
                  roles: false,
                  lit: false,
                  english: false,
                });
                setAttempt('');
                if (next) navigate(`/books/${bookId}/practice/${next.sentenceId}`);
              }}
            >
              Next
            </button>
            <Link to={`/books/${bookId}/analyze/${sentence.id}`}>
              <button type="button">Analyze</button>
            </Link>
          </div>
        </div>
        <div className="jp jp-lg">{sentence.japanese}</div>
        <VocabChips items={sentence.targetVocabulary} />
        <label>
          Temporary attempt (not saved unless you copy into Analyze)
          <textarea
            value={attempt}
            onChange={(event) => setAttempt(event.target.value)}
            placeholder="Optional scratch notes…"
          />
        </label>
        <div className="row">
          <button
            type="button"
            onClick={() => setReveal((value) => ({ ...value, chunks: true }))}
          >
            Reveal chunks
          </button>
          <button
            type="button"
            onClick={() => setReveal((value) => ({ ...value, roles: true }))}
          >
            Reveal roles
          </button>
          <button
            type="button"
            onClick={() => setReveal((value) => ({ ...value, lit: true }))}
          >
            Reveal literal English
          </button>
          <button
            type="button"
            onClick={() => setReveal((value) => ({ ...value, english: true }))}
          >
            Reveal Satori English
          </button>
        </div>
        <div className="summary-lines">
          {reveal.chunks ? `CHUNK: ${summary.chunk}` : 'CHUNK: (hidden)'}
          {'\n'}
          {reveal.roles ? `ROLE: ${summary.role}` : 'ROLE: (hidden)'}
          {'\n'}
          {reveal.lit ? `LIT: ${summary.lit}` : 'LIT: (hidden)'}
          {'\n'}
          {reveal.english
            ? `EN: ${sentence.translation || '(none)'}`
            : 'EN: (hidden)'}
        </div>
        <div className="row">
          <span className={`status-pill ${membership?.status ?? 'unstarted'}`}>
            {membership?.status ?? 'unstarted'}
          </span>
          <button type="button" onClick={() => void mark('unstarted')}>
            Unstarted
          </button>
          <button type="button" onClick={() => void mark('in_progress')}>
            In progress
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void mark('complete')}
          >
            Complete
          </button>
          <button type="button" onClick={() => void mark('needs_review')}>
            Needs review
          </button>
        </div>
      </section>
    </div>
  );
}
