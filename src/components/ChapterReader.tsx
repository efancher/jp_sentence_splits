import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, type ReactNode } from 'react';

import { getReviewDocument } from '../db/repository';
import type { Sentence } from '../domain/types';

/** Plain chapter lines around the sentence being worked on; the active sentence renders `activeView`. */
export function ChapterReader({
  sentenceId,
  bookId,
  showEnglish,
  onOpen,
  activeView,
  fallbackContext,
}: {
  sentenceId: string;
  bookId: string;
  showEnglish: boolean;
  onOpen: (sentenceId: string) => void;
  activeView: ReactNode;
  fallbackContext: Sentence[];
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const activeRow = useRef<HTMLDivElement>(null);
  const queryKey = `${sentenceId}:${bookId}`;
  const result = useLiveQuery(async () => {
    try {
      return { key: queryKey, document: await getReviewDocument(sentenceId, bookId) };
    } catch {
      return { key: queryKey, document: null };
    }
  }, [queryKey]);
  const document = result?.key === queryKey ? result.document : null;
  const activeId = document?.activeMembershipId;

  useEffect(() => {
    const container = viewport.current;
    const row = activeRow.current;
    if (!container || !row) return;
    container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top
      - container.clientHeight / 2 + row.clientHeight / 2;
  }, [sentenceId, document?.activeMembershipId]);

  if (!document) {
    return (
      <div className="gloss-reader stack" style={{ gap: '0.3rem' }}>
        {fallbackContext.map((context) => (
          <div key={context.id} style={{ opacity: 0.6 }}>
            <div className="jp">{context.japanese}</div>
          </div>
        ))}
        {activeView}
        <span className="muted">Chapter text unavailable; showing this sentence.</span>
      </div>
    );
  }
  return (
    <div className="gloss-reader review-document">
      <div className="review-document-heading">
        <strong>{document.chapterTitle ?? document.bookTitle}</strong>
        <span className="muted">{document.rows.length} sentences</span>
      </div>
      <div ref={viewport} className="review-document-viewport" role="region" aria-label="Chapter text" tabIndex={0}>
        {document.rows.map((row) => {
          const active = row.membershipId === activeId;
          return (
            <div key={row.membershipId} ref={active ? activeRow : undefined}
              className={`review-document-line${active ? ' review-document-active' : ''}`}
              aria-current={active ? 'true' : undefined}>
              {active ? activeView : (
                <button type="button" className="gloss-reader-line jp" onClick={() => onOpen(row.sentence.id)}
                  title="Gloss this sentence">
                  {row.sentence.japanese}
                </button>
              )}
              {showEnglish && row.sentence.translation ? (
                <div className="muted" style={{ fontSize: '0.85rem' }}>{row.sentence.translation}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
