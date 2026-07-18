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
import {
  addSentencesToBook,
  deleteBook,
  duplicateBookOrdering,
  exportBookBackup,
  findResumeSentence,
  getDb,
  moveBookSentence,
  removeSentencesFromBook,
  reorderBookSentences,
  touchBookOpened,
  updateBook,
} from '../db/repository';
import { downloadText, formatWorksheetCollection } from '../lib/worksheet';
import type { Sentence } from '../domain/types';

function SortableRow({
  id,
  bookId,
  position,
  sentence,
  status,
  selected,
  editOrder,
  onSelect,
  onMove,
}: {
  id: string;
  bookId: string;
  position: number;
  sentence: Sentence;
  status: string;
  selected: boolean;
  editOrder: boolean;
  onSelect: (checked: boolean) => void;
  onMove: (action: 'up' | 'down' | 'top' | 'bottom') => void;
}) {
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
        </div>
      ) : (
        <div className="row">
          <Link to={`/books/${bookId}/analyze/${sentence.id}`}>
            <button type="button" className="primary">
              Analyze
            </button>
          </Link>
        </div>
      )}
    </article>
  );
}

export function BookDetailPage() {
  const { bookId = '' } = useParams();
  const navigate = useNavigate();
  const [editOrder, setEditOrder] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
    return {
      book,
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

  if (!data) return <p className="muted">Loading book…</p>;
  if (!data.book) return <p>Book not found.</p>;

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
          <button
            type="button"
            className={editOrder ? 'primary' : undefined}
            onClick={() => setEditOrder((value) => !value)}
          >
            {editOrder ? 'Done ordering' : 'Edit order'}
          </button>
        </div>
        {data.book.subtitle ? (
          <div className="muted">{data.book.subtitle}</div>
        ) : null}
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
          <button
            type="button"
            onClick={async () => {
              const title = window.prompt('Rename book', data.book.title);
              if (!title) return;
              await updateBook(bookId, { title });
            }}
          >
            Rename
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
            className="danger"
            onClick={async () => {
              const ok = window.confirm(
                `Delete book “${data.book.title}”? Sentences remain in your library.`,
              );
              if (!ok) return;
              await deleteBook(bookId);
              navigate('/');
            }}
          >
            Delete book
          </button>
        </div>
        {selected.size ? (
          <div className="row">
            <button
              type="button"
              className="danger"
              onClick={async () => {
                const previous = [...ids];
                const removed = [...selected];
                await removeSentencesFromBook(bookId, removed);
                setSelected(new Set());
                setSnack({
                  message: `Removed ${removed.length} sentence(s)`,
                  undo: async () => {
                    await addSentencesToBook(bookId, removed, 'manual');
                    await reorderBookSentences(bookId, previous);
                  },
                });
              }}
            >
              Remove selected from book
            </button>
          </div>
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
              row.sentence ? (
                <SortableRow
                  key={row.membership.sentenceId}
                  id={row.membership.sentenceId}
                  bookId={bookId}
                  position={row.membership.position}
                  sentence={row.sentence}
                  status={row.analysis?.status ?? row.membership.status}
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
