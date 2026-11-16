import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { listSentenceLadderRows, readSettings, type SentenceLadderListRow } from '../db/repository';
import type { StudyItem } from '../domain/types';
import { dictationTileIndex } from '../lib/earTiles';
import {
  countLadderStages,
  filterSentenceLadderRows,
  LADDER_STAGE_LABELS,
  LADDER_STAGES,
  type LadderFilter,
} from '../lib/sentenceCardLadder';

const PAGE_SIZE = 100;

const FILTER_LABELS: Record<LadderFilter, string> = {
  due: 'Due now',
  all: 'All',
  lapsed: 'Lapsed',
};

/**
 * `/study-items`: the sentence-led card ladder, one row per met sentence. Each row shows its
 * Read (`reading_in_context`) card, the audio cards (Listening, Ear tiles, then one Dictation card
 * per tile), when the next is due and how often they lapsed; each chip opens that card's
 * `/study-items/:id` debug view. Retired word/grammar drill cards are not listed (their rows stay as
 * evidence and their debug pages still open from Progress and Issues). Raw due dates only: Review may
 * serve fewer after its gates and daily caps.
 */
export function StudyItemsListPage() {
  // One timestamp per mount keeps "due now" stable while the live query re-runs.
  const [now] = useState(() => new Date().toISOString());
  const rows = useLiveQuery(() => listSentenceLadderRows(now), [now]);
  const settings = useLiveQuery(() => readSettings(), []);
  const [filter, setFilter] = useState<LadderFilter>('due');
  const [bookId, setBookId] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);

  const books = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of rows ?? []) if (row.book) byId.set(row.book.id, row.book.title);
    return [...byId].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const inBook = useMemo(
    () => (rows ?? []).filter((row) => !bookId || row.book?.id === bookId),
    [rows, bookId],
  );
  const stageCounts = useMemo(() => countLadderStages(inBook, now), [inBook, now]);
  const counts: Record<LadderFilter, number> = {
    due: inBook.filter((row) => row.dueNowCount > 0).length,
    all: inBook.length,
    lapsed: inBook.filter((row) => row.lapses > 0).length,
  };
  const visible = useMemo(() => filterSentenceLadderRows(inBook, filter), [inBook, filter]);

  if (rows === undefined) return <p className="muted">Loading…</p>;

  if (rows.length === 0) {
    return (
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Sentence cards</h2>
        <p className="muted" style={{ margin: 0 }}>
          No sentences met yet. Finishing a walkthrough in the reader adds a sentence and its first card.
        </p>
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Sentence cards</h2>
        <p className="muted" style={{ margin: 0 }}>
          {inBook.length} met sentence{inBook.length === 1 ? '' : 's'}. Each one climbs from Read to the
          audio cards: Ear tiles, then one Dictation card per phrase. Raw due dates only; Review may serve
          fewer after its gates and daily caps.
        </p>
        {settings?.sentenceCardsPaused ? (
          <p style={{ margin: 0 }}>Sentence cards are paused in Settings, so Review is not serving these.</p>
        ) : null}
        <table>
          <thead>
            <tr>
              <th align="left">Stage</th>
              <th align="right">Sentences</th>
              <th align="right">Cards due</th>
            </tr>
          </thead>
          <tbody>
            {stageCounts.map((row) => (
              <tr key={row.stage}>
                <td>{LADDER_STAGE_LABELS[row.stage]}</td>
                <td align="right">{row.sentences}</td>
                <td align="right">{row.due}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel stack">
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          {(Object.keys(FILTER_LABELS) as LadderFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              className={filter === key ? 'primary' : undefined}
              onClick={() => {
                setFilter(key);
                setShown(PAGE_SIZE);
              }}
            >
              {FILTER_LABELS[key]} ({counts[key]})
            </button>
          ))}
          {books.length > 1 ? (
            <label className="row" style={{ gap: '0.35rem' }}>
              Book
              <select
                value={bookId}
                onChange={(event) => {
                  setBookId(event.target.value);
                  setShown(PAGE_SIZE);
                }}
              >
                <option value="">All books</option>
                {books.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {visible.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {filter === 'due' ? 'Nothing due right now.' : filter === 'lapsed' ? 'No lapsed sentences.' : 'No sentences.'}
          </p>
        ) : (
          <div className="stack" style={{ gap: '0.25rem' }}>
            {visible.slice(0, shown).map((row) => (
              <SentenceRow key={row.sentenceId} row={row} now={now} />
            ))}
            {visible.length > shown ? (
              <button type="button" onClick={() => setShown((value) => value + PAGE_SIZE)}>
                Show more ({visible.length - shown} left)
              </button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function SentenceRow({ row, now }: { row: SentenceLadderListRow; now: string }) {
  const readerLink = row.book
    ? `/books/${row.book.id}/read${row.book.chapterId ? `?chapter=${encodeURIComponent(row.book.chapterId)}` : ''}`
    : undefined;
  return (
    <div className="list-card stack" style={{ gap: '0.35rem' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        {readerLink ? (
          <Link to={readerLink} className="jp">
            {row.japanese}
          </Link>
        ) : (
          <span className="jp">{row.japanese}</span>
        )}
        <span className="muted" style={{ whiteSpace: 'nowrap' }}>
          {row.nextDue ? `Due ${new Date(row.nextDue).toLocaleDateString()}` : 'No cards yet'}
        </span>
      </div>
      {row.translation ? (
        <span className="muted" style={{ fontSize: '0.9rem' }}>
          {row.translation}
        </span>
      ) : null}
      <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
        {LADDER_STAGES.map((stage) => {
          const cards = row.stages[stage];
          // Listening is an older audio card; only show it where one exists.
          if (stage === 'listening' && cards.length === 0) return null;
          if (stage === 'dictation') {
            if (cards.length === 0 && row.dictationTileCount === null) return null;
            const total = row.dictationTileCount ?? cards.length;
            return (
              <span key={stage} className="chip">
                {LADDER_STAGE_LABELS.dictation} {cards.length}/{total}
                {cards.map((card) => (
                  <CardLink key={card.id} card={card} now={now} label={tileLabel(card)} />
                ))}
              </span>
            );
          }
          return (
            <span key={stage} className="chip" style={cards.length === 0 ? { opacity: 0.55 } : undefined}>
              {LADDER_STAGE_LABELS[stage]}
              {cards.length === 0 ? <span className="muted">not yet</span> : null}
              {cards.map((card) => (
                <CardLink key={card.id} card={card} now={now} label={card.fsrsState.state} />
              ))}
            </span>
          );
        })}
        {row.lapses > 0 ? <span className="muted">{row.lapses} lapse{row.lapses === 1 ? '' : 's'}</span> : null}
        {row.book ? <span className="muted">{row.book.title}</span> : null}
      </div>
    </div>
  );
}

function tileLabel(card: StudyItem): string {
  const index = dictationTileIndex(card.activityType);
  return index === null ? 'whole' : `#${index + 1}`;
}

function CardLink({ card, now, label }: { card: StudyItem; now: string; label: string }) {
  const due = card.fsrsState.due <= now;
  return (
    <Link
      to={`/study-items/${card.id}`}
      title={`${card.activityType}: ${card.fsrsState.state}, due ${new Date(card.fsrsState.due).toLocaleString()}`}
      style={due ? { fontWeight: 600 } : undefined}
    >
      {label}
      {due ? ' · due' : ''}
    </Link>
  );
}
