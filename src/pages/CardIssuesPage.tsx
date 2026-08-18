import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { listCardIssueReportsWithContext, resolveCardIssueReport } from '../db/repository';

/**
 * Lists card issues reported from ReviewPage's "Report issue" button —
 * meant for batch triage, not immediate action: reports pile up here (and
 * sync to Supabase, queryable via scripts/list-card-issues.ts for a future
 * Claude session) until reviewed in one sitting.
 */
export function CardIssuesPage() {
  const [showResolved, setShowResolved] = useState(false);
  const items = useLiveQuery(() => listCardIssueReportsWithContext(), []);
  const visible = items?.filter(
    (item) => showResolved || item.report.status === 'open',
  );

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Reported issues</h2>
          <label className="row muted" style={{ gap: '0.25rem' }}>
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(event) => setShowResolved(event.target.checked)}
            />
            Show resolved
          </label>
        </div>
        {items === undefined ? (
          <p className="muted">Loading…</p>
        ) : visible!.length === 0 ? (
          <p className="muted">
            No {showResolved ? '' : 'open '}issues reported.
          </p>
        ) : (
          <div className="stack" style={{ gap: '0.5rem' }}>
            {visible!.map(({ report, sentence }) => (
              <div key={report.id} className="list-card stack">
                {sentence ? <div className="jp">{sentence.japanese}</div> : null}
                <div className="muted">
                  {report.activityType} · {new Date(report.createdAt).toLocaleString()}
                </div>
                <div>{report.note}</div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <Link to={`/study-items/${report.studyItemId}`}>View card</Link>
                  {report.status === 'open' ? (
                    <button
                      type="button"
                      onClick={() => void resolveCardIssueReport(report.id)}
                    >
                      Mark resolved
                    </button>
                  ) : (
                    <span className="muted">Resolved</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
