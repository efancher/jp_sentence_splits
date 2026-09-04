import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import {
  listCardIssueReportsWithContext,
  listSyncIssueReports,
  resolveCardIssueReport,
  resolveSyncIssueReport,
} from '../db/repository';

/**
 * Lists issues reported from in-app "Report issue"/"Report sync issue"
 * buttons (ReviewPage cards, and ConflictPanel/Account & sync settings for
 * sync trouble) — meant for batch triage, not immediate action: reports
 * pile up here (and sync to Supabase, queryable via
 * scripts/list-card-issues.ts / scripts/list-sync-issues.ts for a future
 * Claude session) until reviewed in one sitting.
 */
export function CardIssuesPage() {
  const [showResolved, setShowResolved] = useState(false);
  const [showResolvedSync, setShowResolvedSync] = useState(false);
  const items = useLiveQuery(() => listCardIssueReportsWithContext(), []);
  const visible = items?.filter(
    (item) => showResolved || item.report.status === 'open',
  );
  const syncItems = useLiveQuery(() => listSyncIssueReports(), []);
  const visibleSync = syncItems?.filter(
    (report) => showResolvedSync || report.status === 'open',
  );

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Sync issues</h2>
          <label className="row muted" style={{ gap: '0.25rem' }}>
            <input
              type="checkbox"
              checked={showResolvedSync}
              onChange={(event) => setShowResolvedSync(event.target.checked)}
            />
            Show resolved
          </label>
        </div>
        {syncItems === undefined ? (
          <p className="muted">Loading…</p>
        ) : visibleSync!.length === 0 ? (
          <p className="muted">
            No {showResolvedSync ? '' : 'open '}sync issues reported.
          </p>
        ) : (
          <div className="stack" style={{ gap: '0.5rem' }}>
            {visibleSync!.map((report) => (
              <div key={report.id} className="list-card stack">
                <div className="muted">
                  {report.conflictEntity
                    ? `${report.conflictEntity} · ${report.conflictRecordId}`
                    : 'General'}{' '}
                  · {new Date(report.createdAt).toLocaleString()}
                </div>
                <div>{report.note}</div>
                <details>
                  <summary className="muted">Diagnostics snapshot</summary>
                  <pre className="conflict-pre">{report.diagnosticsSnapshot}</pre>
                </details>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  {report.status === 'open' ? (
                    <button
                      type="button"
                      onClick={() => void resolveSyncIssueReport(report.id)}
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
            {visible!.map(({ report, sentence, bookId, vocabularyExpression }) => (
              <div key={report.id} className="list-card stack">
                {sentence ? <div className="jp">{sentence.japanese}</div> : null}
                <div className="muted">
                  {report.activityType} · {new Date(report.createdAt).toLocaleString()}
                </div>
                <div>{report.note}</div>
                <div
                  className="row"
                  style={{ gap: '0.75rem', flexWrap: 'wrap' }}
                >
                  <Link to={`/study-items/${report.studyItemId}`}>View card</Link>
                  {bookId && report.sentenceId ? (
                    <Link to={`/books/${bookId}/analyze/${report.sentenceId}`}>
                      Open in Analyze
                    </Link>
                  ) : null}
                  {vocabularyExpression ? (
                    <Link
                      to={`/vocabulary?q=${encodeURIComponent(vocabularyExpression)}`}
                    >
                      Find in vocabulary
                    </Link>
                  ) : null}
                </div>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
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
