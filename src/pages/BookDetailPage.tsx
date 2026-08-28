import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Snackbar } from '../components/Snackbar';
import { VocabChips } from '../components/VocabChips';
import { BookSharingPanel } from '../components/BookSharingPanel';
import {
  assignBookSentencesToChapter,
  createBookChapter,
  deleteBookChapter,
  deleteBook,
  duplicateBookOrdering,
  exportBookBackup,
  exportBookMiningPackage,
  applyCuratedVocabularyForBook,
  findResumeSentence,
  getDb,
  moveBookSentence,
  previewBookOrderFromPaste,
  readSettings,
  removeSentencesFromBook,
  reorderBookFromPaste,
  reorderBookSentences,
  restoreBookSentenceSnapshot,
  setBookCollapsedChapterIds,
  touchBookOpened,
  transferBookSentences,
  updateBook,
  updateBookChapter,
} from '../db/repository';
import { curatedVocabForSourceKey } from '../lib/curatedVocabulary';
import { downloadText, formatWorksheetCollection } from '../lib/worksheet';
import { downloadBlob } from '../lib/miningExport';
import { computeGraduatedSubjectIds } from '../lib/scheduling';
import type { Book, Sentence } from '../domain/types';
import type { PasteOrderResult } from '../lib/pasteOrder';

const PASTE_ORDER_PREVIEW_SAMPLE = 8;

function BookMetadataForm({
  book,
  onDone,
}: {
  book: Book;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(book.title);
  const [subtitle, setSubtitle] = useState(book.subtitle ?? '');
  const [sourceUrl, setSourceUrl] = useState(book.sourceUrl ?? '');
  const [notes, setNotes] = useState(book.notes ?? '');

  return (
    <form
      className="panel stack"
      onSubmit={async (event) => {
        event.preventDefault();
        await updateBook(book.id, { title, subtitle, sourceUrl, notes });
        onDone();
      }}
    >
      <h3 style={{ margin: 0 }}>Book details</h3>
      <label>
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Subtitle or source title
        <input
          value={subtitle}
          onChange={(event) => setSubtitle(event.target.value)}
        />
      </label>
      <label>
        Source URL
        <input
          type="url"
          inputMode="url"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          placeholder="https://…"
        />
      </label>
      <label>
        Notes
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <div className="row">
        <button type="submit" className="primary">
          Save details
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function SortableRow({
  id,
  bookId,
  position,
  sentence,
  chapterTitle,
  status,
  vocabularyReviewStatus,
  graduated,
  selected,
  editOrder,
  onSelect,
  onMove,
}: {
  id: string;
  bookId: string;
  position: number;
  sentence: Sentence;
  chapterTitle?: string;
  status: string;
  /** Undefined means no analysis row exists yet — never opened AnalyzePage for this sentence. */
  vocabularyReviewStatus: 'unreviewed' | 'confirmed' | undefined;
  /** Every one of this sentence's own study items (comprehension/reading_in_context) has crossed the graduation threshold. */
  graduated: boolean;
  selected: boolean;
  editOrder: boolean;
  onSelect: (checked: boolean) => void;
  onMove: (action: 'up' | 'down' | 'top' | 'bottom' | number) => void;
}) {
  const [requestedPosition, setRequestedPosition] = useState(
    String(position + 1),
  );
  useEffect(() => {
    setRequestedPosition(String(position + 1));
  }, [position]);
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id, disabled: !editOrder });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article ref={setNodeRef} style={style} className="list-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <label className="row">
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelect(event.target.checked)}
          />
          <span className="muted">#{position + 1}</span>
          <span className={`status-pill ${status}`}>{status}</span>
          <span className={`status-pill ${vocabularyReviewStatus ?? 'unreviewed'}`}>
            vocab: {vocabularyReviewStatus === 'confirmed' ? 'confirmed' : 'needs review'}
          </span>
          {graduated ? <span className="status-pill">Graduated</span> : null}
        </label>
        {editOrder ? (
          <button
            type="button"
            className="drag-handle ghost"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            ⋮⋮
          </button>
        ) : null}
      </div>
      <div className="jp">{sentence.japanese}</div>
      {chapterTitle ? <span className="chip">{chapterTitle}</span> : null}
      <div className="muted">{sentence.translation}</div>
      <VocabChips items={sentence.targetVocabulary} />
      {editOrder ? (
        <div className="row">
          <button type="button" onClick={() => onMove('up')}>
            Up
          </button>
          <button type="button" onClick={() => onMove('down')}>
            Down
          </button>
          <button type="button" onClick={() => onMove('top')}>
            Top
          </button>
          <button type="button" onClick={() => onMove('bottom')}>
            Bottom
          </button>
          <label className="position-control">
            Position
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={requestedPosition}
              onChange={(event) => setRequestedPosition(event.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => onMove(Number(requestedPosition))}
          >
            Move
          </button>
        </div>
      ) : (
        <div className="row">
          <Link to={`/books/${bookId}/analyze/${sentence.id}`}>
            <button type="button" className="primary">
              Analyze
            </button>
          </Link>
          <Link to={`/books/${bookId}/vocabulary/${sentence.id}`}>
            <button type="button">Vocabulary</button>
          </Link>
        </div>
      )}
    </article>
  );
}

/** Sentinel key for sentences that belong to no chapter/episode. */
const UNASSIGNED_CHAPTER_KEY = '__unassigned__';

export function BookDetailPage() {
  const { bookId = '' } = useParams();
  const navigate = useNavigate();
  const [editOrder, setEditOrder] = useState(false);
  const [showPasteOrder, setShowPasteOrder] = useState(false);
  const [pasteOrderText, setPasteOrderText] = useState('');
  const [pasteOrderPreview, setPasteOrderPreview] = useState<
    (PasteOrderResult & {
      matchedJapanese: string[];
      unmatchedJapanese: string[];
    }) | null
  >(null);
  const [pasteOrderError, setPasteOrderError] = useState('');
  const [editMetadata, setEditMetadata] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destinationBookId, setDestinationBookId] = useState('');
  const [chapterTitle, setChapterTitle] = useState('');
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [editingChapterId, setEditingChapterId] = useState<string | null>(
    null,
  );
  const [editingChapterTitle, setEditingChapterTitle] = useState('');
  const [snack, setSnack] = useState<{
    message: string;
    undo?: () => Promise<void>;
  } | null>(null);

  useEffect(() => {
    if (!bookId) return;
    void touchBookOpened(bookId);
  }, [bookId]);

  const data = useLiveQuery(async () => {
    const db = getDb();
    const book = await db.books.get(bookId);
    if (!book) return null;
    const memberships = await db.bookSentences
      .where('bookId')
      .equals(bookId)
      .sortBy('position');
    const sentences = await db.sentences.bulkGet(
      memberships.map((item) => item.sentenceId),
    );
    const analyses = await db.analyses.bulkGet(
      memberships.map((item) => item.sentenceId),
    );
    const otherBooks = await db.books
      .filter((item) => !item.archived && item.id !== bookId)
      .toArray();
    return {
      book,
      otherBooks,
      rows: memberships.map((membership, index) => ({
        membership,
        sentence: sentences[index],
        analysis: analyses[index],
      })),
    };
  }, [bookId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
  );

  const ids = useMemo(
    () => (data?.rows ?? []).map((row) => row.membership.sentenceId),
    [data],
  );

  const settings = useLiveQuery(() => readSettings(), []);
  const sentenceStudyItems = useLiveQuery(
    () => getDb().studyItems.where('subjectType').equals('sentence').toArray(),
    [],
  );
  const graduatedSentenceIds = useMemo(() => {
    if (!sentenceStudyItems || !settings) return new Set<string>();
    return computeGraduatedSubjectIds(sentenceStudyItems, settings.graduationMinScheduledDays);
  }, [sentenceStudyItems, settings]);

  const collapsedChapters = useMemo(
    () => new Set(data?.book?.collapsedChapterIds ?? []),
    [data?.book?.collapsedChapterIds],
  );

  if (!data) return <p className="muted">Loading book…</p>;
  if (!data.book) return <p>Book not found.</p>;

  function toggleChapterCollapsed(chapterKey: string) {
    const next = new Set(collapsedChapters);
    if (next.has(chapterKey)) next.delete(chapterKey);
    else next.add(chapterKey);
    void setBookCollapsedChapterIds(bookId, [...next]);
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const previous = [...ids];
    const next = arrayMove(ids, oldIndex, newIndex);
    await reorderBookSentences(bookId, next);
    setSnack({
      message: 'Order updated',
      undo: async () => {
        await reorderBookSentences(bookId, previous);
      },
    });
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{data.book.title}</h2>
          <div className="row">
            <button
              type="button"
              className={editOrder ? 'primary' : undefined}
              onClick={() => setEditOrder((value) => !value)}
            >
              {editOrder ? 'Done ordering' : 'Edit order'}
            </button>
            <button
              type="button"
              className={showPasteOrder ? 'primary' : undefined}
              onClick={() => {
                setShowPasteOrder((value) => !value);
                setPasteOrderError('');
              }}
            >
              {showPasteOrder ? 'Hide paste order' : 'Order from paste'}
            </button>
          </div>
        </div>
        {data.book.subtitle ? (
          <div className="muted">{data.book.subtitle}</div>
        ) : null}
        {data.book.sourceUrl ? (
          <a href={data.book.sourceUrl} target="_blank" rel="noreferrer">
            Open source
          </a>
        ) : null}
        {data.book.notes ? <p style={{ margin: 0 }}>{data.book.notes}</p> : null}
        <section className="panel stack">
          <BookSharingPanel bookId={bookId} />
        </section>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={async () => {
              const sentenceId = await findResumeSentence(bookId);
              if (sentenceId) {
                navigate(`/books/${bookId}/analyze/${sentenceId}`);
              }
            }}
          >
            Resume
          </button>
          <Link to={`/books/${bookId}/practice`}>
            <button type="button">Practice</button>
          </Link>
          <Link to={`/books/${bookId}/build`}>
            <button type="button">Build</button>
          </Link>
          <Link to={`/books/${bookId}/review`}>
            <button type="button">Review</button>
          </Link>
          {data.book.sourceKey?.startsWith('shadowing:') ? (
            <Link to={`/books/${bookId}/resegment`}>
              <button type="button">Re-segment captions</button>
            </Link>
          ) : null}
          <button type="button" onClick={() => setEditMetadata(true)}>
            Edit details
          </button>
          <button
            type="button"
            onClick={async () => {
              await updateBook(bookId, { archived: !data.book.archived });
            }}
          >
            {data.book.archived ? 'Restore' : 'Archive'}
          </button>
          <button
            type="button"
            onClick={async () => {
              const copy = await duplicateBookOrdering(bookId);
              navigate(`/books/${copy.id}`);
            }}
          >
            Duplicate order
          </button>
          <button
            type="button"
            onClick={async () => {
              const payload = await exportBookBackup(bookId);
              downloadText(
                `${data.book.title.replace(/\s+/g, '-').toLowerCase()}-backup.json`,
                JSON.stringify(payload, null, 2),
                'application/json',
              );
            }}
          >
            Export book
          </button>
          <button
            type="button"
            onClick={() => {
              const worksheet = formatWorksheetCollection(
                data.rows
                  .filter((row) => row.sentence)
                  .map((row, index) => ({
                    sentence: row.sentence!,
                    chunks: row.analysis?.chunks ?? [],
                    index: index + 1,
                    sourceLabel: data.book.title,
                  })),
              );
              downloadText(
                `${data.book.title.replace(/\s+/g, '-').toLowerCase()}.txt`,
                worksheet,
                'text/plain',
              );
            }}
          >
            Export worksheet
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                const result = await exportBookMiningPackage(bookId);
                downloadBlob(result.blob, result.filename);
                window.alert(
                  `Exported ${result.sentenceCount} confirmed sentence(s) with ${result.selectionCount} vocabulary selection(s). Skipped ${result.skippedUnconfirmed} unconfirmed.`,
                );
              } catch (error) {
                window.alert(
                  error instanceof Error ? error.message : String(error),
                );
              }
            }}
          >
            Export Anki mining package
          </button>
          {curatedVocabForSourceKey(data.book.sourceKey) ? (
            <button
              type="button"
              onClick={async () => {
                const ok = window.confirm(
                  'Apply curated Anki vocabulary picks for this immersion book?\n\nThis overwrites unreviewed vocabulary selections. Already-confirmed sentences are left alone.',
                );
                if (!ok) return;
                try {
                  const result = await applyCuratedVocabularyForBook(bookId);
                  window.alert(
                    `Updated ${result.updated} sentence(s); ${result.confirmed} confirmed with picks. Skipped ${result.skippedConfirmed} already confirmed. Missing pack rows: ${result.missingPicks}. Unresolved picks: ${result.unresolvedPicks}.`,
                  );
                } catch (error) {
                  window.alert(
                    error instanceof Error ? error.message : String(error),
                  );
                }
              }}
            >
              Apply curated vocab picks
            </button>
          ) : null}
          <button
            type="button"
            className="danger"
            onClick={async () => {
              const ok = window.confirm(
                `Delete book “${data.book.title}”? Sentences remain in your library.`,
              );
              if (!ok) return;
              await deleteBook(bookId);
              navigate('/books');
            }}
          >
            Delete book
          </button>
        </div>
        {selected.size ? (
          <div className="panel stack">
            <strong>{selected.size} selected</strong>
            <label>
              Chapter
              <select
                value={selectedChapterId}
                onChange={(event) => setSelectedChapterId(event.target.value)}
              >
                <option value="">Unassigned</option>
                {(data.book.chapters ?? [])
                  .slice()
                  .sort((a, b) => a.position - b.position)
                  .map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>
                      {chapter.title}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              onClick={async () => {
                await assignBookSentencesToChapter(
                  bookId,
                  [...selected],
                  selectedChapterId || undefined,
                );
                setSnack({
                  message: selectedChapterId
                    ? `Assigned ${selected.size} sentence(s) to chapter.`
                    : `Removed ${selected.size} sentence(s) from chapters.`,
                });
                setSelected(new Set());
              }}
            >
              Apply chapter
            </button>
            <label>
              Another book
              <select
                value={destinationBookId}
                onChange={(event) => setDestinationBookId(event.target.value)}
              >
                <option value="">Choose a book…</option>
                {data.otherBooks.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="row">
              <button
                type="button"
                disabled={!destinationBookId}
                onClick={async () => {
                  await transferBookSentences({
                    sourceBookId: bookId,
                    destinationBookId,
                    sentenceIds: [...selected],
                    mode: 'copy',
                  });
                  setSnack({ message: `Copied ${selected.size} sentence(s).` });
                  setSelected(new Set());
                }}
              >
                Copy to book
              </button>
              <button
                type="button"
                disabled={!destinationBookId}
                onClick={async () => {
                  await transferBookSentences({
                    sourceBookId: bookId,
                    destinationBookId,
                    sentenceIds: [...selected],
                    mode: 'move',
                  });
                  setSnack({ message: `Moved ${selected.size} sentence(s).` });
                  setSelected(new Set());
                }}
              >
                Move to book
              </button>
            <button
              type="button"
              className="danger"
              onClick={async () => {
                const removed = [...selected];
                const snapshot = await removeSentencesFromBook(bookId, removed);
                setSelected(new Set());
                setSnack({
                  message: `Removed ${removed.length} sentence(s)`,
                  undo: async () => {
                    await restoreBookSentenceSnapshot(bookId, snapshot);
                  },
                });
              }}
            >
              Remove selected from book
            </button>
            </div>
          </div>
        ) : null}
      </section>

      {editMetadata ? (
        <BookMetadataForm
          key={data.book.updatedAt}
          book={data.book}
          onDone={() => setEditMetadata(false)}
        />
      ) : null}

      {showPasteOrder ? (
        <section className="panel stack">
          <h3 style={{ margin: 0 }}>Order from paste</h3>
          <p className="muted" style={{ margin: 0 }}>
            Paste article text from a Satori chapter page. Matching book
            sentences are reordered by first appearance; episode titles count as
            sentences when they are already in the book. Unmatched sentences
            keep their relative order at the end. After Apply, scroll the list:
            episode titles like 春、第一話 should move near the top when present.
          </p>
          <label>
            Pasted text
            <textarea
              rows={10}
              value={pasteOrderText}
              onChange={(event) => {
                setPasteOrderText(event.target.value);
                setPasteOrderPreview(null);
                setPasteOrderError('');
              }}
              placeholder="春、第二話&#10;ある日、…"
            />
          </label>
          {pasteOrderError ? (
            <div style={{ color: 'var(--danger)' }}>{pasteOrderError}</div>
          ) : null}
          {pasteOrderPreview ? (
            <div className="stack">
              <div className="muted">
                {pasteOrderPreview.matchedIds.length} matched ·{' '}
                {pasteOrderPreview.unmatchedIds.length} unmatched
              </div>
              {pasteOrderPreview.matchedIds.length ? (
                <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
                  {pasteOrderPreview.matchedJapanese
                    .slice(0, PASTE_ORDER_PREVIEW_SAMPLE)
                    .map((japanese, index) => (
                      <li key={`${index}-${japanese}`} className="jp">
                        {japanese}
                      </li>
                    ))}
                </ol>
              ) : (
                <div className="muted">No book sentences found in the paste.</div>
              )}
              {pasteOrderPreview.matchedJapanese.length >
              PASTE_ORDER_PREVIEW_SAMPLE ? (
                <div className="muted">
                  …and{' '}
                  {pasteOrderPreview.matchedJapanese.length -
                    PASTE_ORDER_PREVIEW_SAMPLE}{' '}
                  more matched
                </div>
              ) : null}
              {pasteOrderPreview.unmatchedJapanese.length ? (
                <div className="stack">
                  <strong>Unmatched (kept at end)</strong>
                  <ul
                    className="muted"
                    style={{ margin: 0, paddingLeft: '1.2rem' }}
                  >
                    {pasteOrderPreview.unmatchedJapanese
                      .slice(0, PASTE_ORDER_PREVIEW_SAMPLE)
                      .map((japanese, index) => (
                        <li key={`u-${index}-${japanese}`} className="jp">
                          {japanese}
                        </li>
                      ))}
                  </ul>
                  {pasteOrderPreview.unmatchedJapanese.length >
                  PASTE_ORDER_PREVIEW_SAMPLE ? (
                    <div className="muted">
                      …and{' '}
                      {pasteOrderPreview.unmatchedJapanese.length -
                        PASTE_ORDER_PREVIEW_SAMPLE}{' '}
                      more unmatched
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="row">
            <button
              type="button"
              disabled={!pasteOrderText.trim()}
              onClick={async () => {
                setPasteOrderError('');
                try {
                  setPasteOrderPreview(
                    await previewBookOrderFromPaste(bookId, pasteOrderText),
                  );
                } catch (err) {
                  setPasteOrderError(
                    err instanceof Error
                      ? err.message
                      : 'Failed to preview paste order',
                  );
                }
              }}
            >
              Preview
            </button>
            <button
              type="button"
              className="primary"
              disabled={!pasteOrderText.trim()}
              onClick={async () => {
                setPasteOrderError('');
                try {
                  const previous = [...ids];
                  const result = await reorderBookFromPaste(
                    bookId,
                    pasteOrderText,
                  );
                  setPasteOrderPreview(result);
                  if (!result.matchedIds.length) {
                    setPasteOrderError(
                      'No book sentences matched the pasted text.',
                    );
                    return;
                  }
                  setSnack({
                    message: `Reordered ${result.matchedIds.length} matched · ${result.unmatchedIds.length} unmatched at end`,
                    undo: async () => {
                      await reorderBookSentences(bookId, previous);
                    },
                  });
                } catch (err) {
                  setPasteOrderError(
                    err instanceof Error
                      ? err.message
                      : 'Failed to apply paste order',
                  );
                }
              }}
            >
              Apply order
            </button>
            <button
              type="button"
              onClick={() => {
                setShowPasteOrder(false);
                setPasteOrderPreview(null);
                setPasteOrderError('');
              }}
            >
              Close
            </button>
          </div>
        </section>
      ) : null}

      <section className="panel stack">
        <div>
          <h3 style={{ margin: 0 }}>Chapters</h3>
          <p className="muted" style={{ margin: '0.25rem 0 0' }}>
            Chapters label sections without duplicating or changing sentence
            analysis.
          </p>
        </div>
        <form
          className="row"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!chapterTitle.trim()) return;
            await createBookChapter(bookId, chapterTitle);
            setChapterTitle('');
          }}
        >
          <input
            value={chapterTitle}
            onChange={(event) => setChapterTitle(event.target.value)}
            placeholder="New chapter title"
            aria-label="New chapter title"
          />
          <button type="submit">Add chapter</button>
        </form>
        {(data.book.chapters ?? [])
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((chapter, chapterIndex, chapters) => {
            const sentenceCount = data.rows.filter(
              (row) => row.membership.chapterId === chapter.id,
            ).length;
            const collapsed = collapsedChapters.has(chapter.id);
            const isEditing = editingChapterId === chapter.id;
            return (
              <div key={chapter.id} className="chapter-row">
                {isEditing ? (
                  <form
                    className="row"
                    style={{ flex: 1 }}
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const title = editingChapterTitle.trim();
                      if (title) {
                        await updateBookChapter(bookId, chapter.id, {
                          title,
                        });
                      }
                      setEditingChapterId(null);
                    }}
                  >
                    <input
                      autoFocus
                      value={editingChapterTitle}
                      onChange={(event) =>
                        setEditingChapterTitle(event.target.value)
                      }
                      aria-label="Chapter title"
                    />
                    <button type="submit">Save</button>
                    <button
                      type="button"
                      onClick={() => setEditingChapterId(null)}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <div>
                      <strong>{chapter.title}</strong>
                      <div className="muted">
                        {sentenceCount} sentence
                        {sentenceCount === 1 ? '' : 's'}
                        {collapsed ? ' · hidden' : ''}
                      </div>
                    </div>
                    <div className="row">
                      <button
                        type="button"
                        className={collapsed ? 'primary' : undefined}
                        aria-pressed={collapsed}
                        onClick={() => toggleChapterCollapsed(chapter.id)}
                      >
                        {collapsed ? 'Show' : 'Hide'}
                      </button>
                      <button
                        type="button"
                        disabled={chapterIndex === 0}
                        onClick={() =>
                          void updateBookChapter(bookId, chapter.id, {
                            position: chapterIndex - 1,
                          })
                        }
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        disabled={chapterIndex === chapters.length - 1}
                        onClick={() =>
                          void updateBookChapter(bookId, chapter.id, {
                            position: chapterIndex + 1,
                          })
                        }
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingChapterTitle(chapter.title);
                          setEditingChapterId(chapter.id);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete chapter “${chapter.title}”? Its sentences will become unassigned.`,
                            )
                          ) {
                            void deleteBookChapter(bookId, chapter.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        {(() => {
          const unassignedCount = data.rows.filter(
            (row) => !row.membership.chapterId,
          ).length;
          if (!unassignedCount) return null;
          const collapsed = collapsedChapters.has(UNASSIGNED_CHAPTER_KEY);
          return (
            <div className="chapter-row">
              <div>
                <strong>Unassigned</strong>
                <div className="muted">
                  {unassignedCount} sentence{unassignedCount === 1 ? '' : 's'}
                  {collapsed ? ' · hidden' : ''}
                </div>
              </div>
              <div className="row">
                <button
                  type="button"
                  className={collapsed ? 'primary' : undefined}
                  aria-pressed={collapsed}
                  onClick={() =>
                    toggleChapterCollapsed(UNASSIGNED_CHAPTER_KEY)
                  }
                >
                  {collapsed ? 'Show' : 'Hide'}
                </button>
              </div>
            </div>
          );
        })()}
        {collapsedChapters.size > 0 ? (
          <button
            type="button"
            onClick={() => void setBookCollapsedChapterIds(bookId, [])}
          >
            Show all sentences
          </button>
        ) : null}
        {!data.book.chapters?.length ? (
          <span className="muted">No chapters yet.</span>
        ) : null}
      </section>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(event) => void onDragEnd(event)}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="stack">
            {data.rows.map((row) =>
              row.sentence &&
              !collapsedChapters.has(
                row.membership.chapterId ?? UNASSIGNED_CHAPTER_KEY,
              ) ? (
                <SortableRow
                  key={row.membership.sentenceId}
                  id={row.membership.sentenceId}
                  bookId={bookId}
                  position={row.membership.position}
                  sentence={row.sentence}
                  chapterTitle={data.book.chapters?.find(
                    (chapter) => chapter.id === row.membership.chapterId,
                  )?.title}
                  status={row.analysis?.status ?? row.membership.status}
                  vocabularyReviewStatus={row.analysis?.vocabularyReviewStatus}
                  graduated={graduatedSentenceIds.has(row.membership.sentenceId)}
                  selected={selected.has(row.membership.sentenceId)}
                  editOrder={editOrder}
                  onSelect={(checked) => {
                    const next = new Set(selected);
                    if (checked) next.add(row.membership.sentenceId);
                    else next.delete(row.membership.sentenceId);
                    setSelected(next);
                  }}
                  onMove={(action) => {
                    const previous = [...ids];
                    void moveBookSentence(
                      bookId,
                      row.membership.sentenceId,
                      action,
                    ).then(() =>
                      setSnack({
                        message: 'Order updated',
                        undo: async () =>
                          reorderBookSentences(bookId, previous),
                      }),
                    );
                  }}
                />
              ) : null,
            )}
          </div>
        </SortableContext>
      </DndContext>

      {snack ? (
        <Snackbar
          message={snack.message}
          actionLabel={snack.undo ? 'Undo' : undefined}
          onAction={
            snack.undo
              ? () => {
                  void snack.undo?.().then(() => setSnack(null));
                }
              : undefined
          }
          onDismiss={() => setSnack(null)}
        />
      ) : null}
    </div>
  );
}
