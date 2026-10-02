import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, useEffect, useRef } from 'react';

import { getReviewDocument } from '../db/repository';
import type { Sentence } from '../domain/types';
import { maskReviewText, reviewDocumentMaskForms, type ReviewTextSpan } from '../lib/reviewDocument';

/** Plain Japanese only: hidden targets must not leak through ruby, glosses or audio. */
export function ReviewDocumentText({
  sentence,
  bookId,
  target,
  revealed,
  cloze,
  onDocumentShown,
}: {
  sentence: Sentence;
  bookId?: string;
  target?: ReviewTextSpan[];
  revealed: boolean;
  cloze?: { vocabularyItemId: string; expression: string; surface: string };
  /** Reports how many source sentences are visible (1 = fell back to the lone sentence). */
  onDocumentShown?: (sentenceCount: number) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const activeRow = useRef<HTMLParagraphElement>(null);
  const queryKey = `${sentence.id}:${bookId ?? ''}:${cloze?.vocabularyItemId ?? ''}`;
  const result = useLiveQuery(async () => {
    try {
      return { key: queryKey, document: await getReviewDocument(sentence.id, bookId, cloze?.vocabularyItemId) };
    } catch {
      // The current review remains usable if context is missing/unavailable.
      return { key: queryKey, document: null };
    }
  }, [queryKey]);
  // useLiveQuery can briefly retain a prior result when the next card loads.
  const document = result?.key === queryKey ? result.document : null;
  const rows = document?.rows ?? [{ membershipId: sentence.id, sentence }];
  const activeId = document?.activeMembershipId ?? sentence.id;
  const forms = cloze && !revealed
    ? reviewDocumentMaskForms(rows.map((row) => row.sentence), cloze.expression, cloze.surface, document?.vocabularyForms)
    : [];
  const mask = (text: string) => maskReviewText(text, forms);
  const validTargets = (target ?? []).filter(
    (span) => span.start >= 0 && span.end > span.start && span.end <= sentence.japanese.length,
  );

  function returnToTarget() {
    const container = viewport.current;
    const row = activeRow.current;
    if (!container || !row) return;
    // Scroll this document only; never jump the whole page away from response controls.
    container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top
      - container.clientHeight / 2 + row.clientHeight / 2;
  }

  const shownCount = result?.key === queryKey ? rows.length : undefined;
  useEffect(() => {
    if (shownCount !== undefined) onDocumentShown?.(shownCount);
  }, [shownCount, queryKey]);

  useEffect(() => { returnToTarget(); }, [queryKey, document?.activeMembershipId]);

  return (
    <section className="review-document" aria-label="Review source">
      <div className="review-document-heading">
        <div>
          <strong>{mask(document?.chapterTitle ?? document?.bookTitle ?? 'Sentence context')}</strong>
          {document?.chapterTitle ? <div className="muted">{mask(document.bookTitle)}</div> : null}
        </div>
        {document ? <span className="muted">{rows.length} sentences</span> : null}
      </div>
      <div ref={viewport} className="review-document-viewport" role="region" aria-label="Chapter text" tabIndex={0}>
        {rows.map((row) => {
          const active = row.membershipId === activeId;
          // Use the exact queued target sentence, not an independently changed DB snapshot.
          const text = active ? sentence.japanese : row.sentence.japanese;
          return (
            <p key={row.membershipId} ref={active ? activeRow : undefined}
              className={`jp review-document-line${active ? ' review-document-active' : ''}`}
              aria-current={active ? 'true' : undefined}>
              {active && validTargets.length ? validTargets.map((span, index) => {
                const previousEnd = index === 0 ? 0 : validTargets[index - 1].end;
                const isLast = index === validTargets.length - 1;
                return (
                  <Fragment key={span.start}>
                    {mask(text.slice(previousEnd, span.start))}
                    <mark>{cloze && !revealed ? '_____' : text.slice(span.start, span.end)}</mark>
                    {isLast ? mask(text.slice(span.end)) : null}
                  </Fragment>
                );
              }) : mask(text)}
            </p>
          );
        })}
      </div>
      <div className="review-document-footer">
        <span className="muted">{document ? 'Scroll to read the surrounding passage.' : result?.key === queryKey ? 'Full source unavailable; showing this sentence.' : 'Loading source…'}</span>
        {document ? <button type="button" onClick={returnToTarget}>Back to target</button> : null}
      </div>
    </section>
  );
}
