import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { listStudyItemSummaries, readSettings } from '../db/repository';
import { countDueByActivityType } from '../lib/scheduling';
import { isActivityTypeInUse } from '../lib/sentenceLed';

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

  const settings = useLiveQuery(() => readSettings(), []);
  const [inUseOnly, setInUseOnly] = useState(true);
  const allCounts = items ? countDueByActivityType(items.map(({ studyItem }) => studyItem)) : [];
  const dueCounts = inUseOnly
    ? allCounts.filter((row) => isActivityTypeInUse(row.activityType, settings))
    : allCounts;

  return (
    <div className="stack">
      {allCounts.length > 0 ? (
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>Due now by card type</h2>
          <p className="muted" style={{ margin: 0 }}>
            Raw due dates only; Review may serve fewer after its gates and daily caps.
          </p>
          <label className="row" style={{ gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={inUseOnly}
              onChange={(event) => setInUseOnly(event.target.checked)}
            />
            Only card types Review is using (hide paused ones)
          </label>
          <table>
            <thead>
              <tr>
                <th align="left">Card type</th>
                <th align="right">Due</th>
                <th align="right">Total</th>
              </tr>
            </thead>
            <tbody>
              {dueCounts.map((row) => (
                <tr key={row.activityType}>
                  <td>{row.activityType}</td>
                  <td align="right">{row.due}</td>
                  <td align="right">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
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
