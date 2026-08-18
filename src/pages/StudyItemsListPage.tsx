import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';

import { listStudyItemSummaries } from '../db/repository';

/**
 * Top-level browsable list of every study item, linking to
 * `/study-items/:id` (Phase 7.10a's debug view) for each. Deferred when
 * 7.10a shipped ("a separate top-level browsable list ... lower value than
 * answering the question for a card you're already looking at") — built
 * now on request. Sorted by due date so the most pressing items surface
 * first; no other filtering, matching this page's "browse everything"
 * purpose rather than duplicating Review's own due-queue logic.
 */
export function StudyItemsListPage() {
  const items = useLiveQuery(() => listStudyItemSummaries(), []);
  const sorted = items
    ? [...items].sort((a, b) =>
        a.studyItem.fsrsState.due.localeCompare(b.studyItem.fsrsState.due),
      )
    : undefined;

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Study items</h2>
        {sorted === undefined ? (
          <p className="muted">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="muted">No study items yet.</p>
        ) : (
          <div className="stack" style={{ gap: '0.25rem' }}>
            {sorted.map(({ studyItem, subjectLabel }) => (
              <Link
                key={studyItem.id}
                to={`/study-items/${studyItem.id}`}
                className="list-card"
                style={{ display: 'block' }}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="jp">{subjectLabel}</span>
                  <span className="muted">{studyItem.activityType}</span>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">{studyItem.fsrsState.state}</span>
                  <span className="muted">
                    Due {new Date(studyItem.fsrsState.due).toLocaleDateString()}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
