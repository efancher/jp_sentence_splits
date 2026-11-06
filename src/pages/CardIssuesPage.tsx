import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import {
  getDb,
  listCardIssueReportsWithContext,
  listChunkIssueReports,
  listSyncIssueReports,
  resolveCardIssueReport,
  resolveSyncIssueReport,
  settleChunkIssueReports,
} from '../db/repository';
import { NativeAudioButton } from '../components/NativeAudioButton';
import { ReadingFlagsPanel } from '../components/ReadingFlagsPanel';
import type { ChunkIssueReport } from '../domain/types';
import { chunkIssueKey } from '../lib/chunkIssues';
import { parseReadingFlagNote } from '../lib/readingFlagFix';

/**
 * Lists issues reported from in-app "Report issue"/"Report sync issue"
 * buttons (ReviewPage cards, and ConflictPanel/Account & sync settings for
 * sync trouble) — meant for batch triage, not immediate action: reports
 * pile up here (and sync to Supabase, queryable via
 * scripts/list-card-issues.ts / scripts/list-sync-issues.ts for a future
 * Claude session) until reviewed in one sitting.
 */
interface ChunkIssueGroup {
  key: string;
  status: ChunkIssueReport['status'];
  source: ChunkIssueReport['source'];
  note: string;
  reports: ChunkIssueReport[];
  examples: { japanese: string; chunks: string[]; bookId?: string; sentenceId: string }[];
}

/** Open furigana flags are judged by ear per sentence (ReadingChecksSection), never as a pattern group. */
function isOpenReadingFlag(report: ChunkIssueReport): boolean {
  return report.status === 'open' && report.source === 'meaning_checks' && parseReadingFlagNote(report.note) !== null;
}

async function loadReadingCheckSentences() {
  const db = getDb();
  const reports = (await listChunkIssueReports()).filter(isOpenReadingFlag);
  const sentenceIds = [...new Set(reports.map((report) => report.sentenceId))];
  const out = [];
  for (const sentenceId of sentenceIds) {
    const sentence = await db.sentences.get(sentenceId);
    if (!sentence) continue;
    const audio = await db.sentenceAudio.where('sentenceId').equals(sentenceId).first();
    out.push({ sentence, audio });
  }
  return out;
}

function ReadingChecksSection() {
  const items = useLiveQuery(() => loadReadingCheckSentences(), []);
  if (!items || items.length === 0) return null;
  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>Reading checks ({items.length})</h2>
      <p className="muted" style={{ margin: 0 }}>
        The furigana and the assistant disagree. Play the sentence, then keep the furigana or use the
        assistant&rsquo;s reading. &ldquo;Keep&rdquo; also stops the same word being flagged on later imports.
      </p>
      {items.map(({ sentence, audio }) => (
        <div key={sentence.id} className="list-card stack">
          {audio ? (
            <NativeAudioButton audio={audio} hideAdjust />
          ) : (
            <span className="muted">No native audio for this sentence.</span>
          )}
          <ReadingFlagsPanel sentence={sentence} />
        </div>
      ))}
    </section>
  );
}

async function loadChunkIssueGroups(): Promise<ChunkIssueGroup[]> {
  const reports = (await listChunkIssueReports()).filter((report) => !isOpenReadingFlag(report));
  const groups = new Map<string, ChunkIssueGroup>();
  for (const report of reports) {
    const key = `${report.status}::${chunkIssueKey(report)}`;
    const group = groups.get(key) ?? {
      key,
      status: report.status,
      source: report.source,
      note: report.note,
      reports: [],
      examples: [],
    };
    group.reports.push(report);
    groups.set(key, group);
  }
  const db = getDb();
  for (const group of groups.values()) {
    for (const report of group.reports.slice(0, 3)) {
      const sentence = await db.sentences.get(report.sentenceId);
      const membership = await db.bookSentences.where('sentenceId').equals(report.sentenceId).first();
      group.examples.push({
        japanese: sentence?.japanese ?? '(sentence not found)',
        chunks: report.chunks,
        bookId: membership?.bookId,
        sentenceId: report.sentenceId,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.reports.length - a.reports.length);
}

function ChunkIssuesSection() {
  const [showSettled, setShowSettled] = useState(false);
  const groups = useLiveQuery(() => loadChunkIssueGroups(), []);
  const visible = groups?.filter((group) => showSettled || group.status === 'open');
  return (
    <section className="panel stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Authoring issues (chunks &amp; meanings)</h2>
        <label className="row muted" style={{ gap: '0.25rem' }}>
          <input type="checkbox" checked={showSettled} onChange={(event) => setShowSettled(event.target.checked)} />
          Show settled
        </label>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Flagged by the assistant when importing particle checks / meaning choices, grouped by pattern.
        &ldquo;Not an issue&rdquo; also stops the same pattern being filed on later imports.
      </p>
      {groups === undefined ? (
        <p className="muted">Loading…</p>
      ) : visible!.length === 0 ? (
        <p className="muted">No {showSettled ? '' : 'open '}authoring issues.</p>
      ) : (
        <div className="stack" style={{ gap: '0.5rem' }}>
          {visible!.map((group) => (
            <div key={group.key} className="list-card stack">
              <div className="muted">
                {group.source === 'meaning_checks' ? 'meaning check' : 'particle check'} · {group.reports.length}{' '}
                {group.reports.length === 1 ? 'sentence' : 'sentences'}
              </div>
              <div className="jp">{group.note}</div>
              {group.examples.map((example) => (
                <div key={example.sentenceId} className="muted" style={{ fontSize: '0.85rem' }}>
                  {example.chunks.length ? example.chunks.join(' | ') : example.japanese}
                  {example.bookId ? (
                    <>
                      {' '}
                      <Link to={`/books/${example.bookId}/analyze/${example.sentenceId}`}>Open</Link>
                    </>
                  ) : null}
                </div>
              ))}
              {group.reports.length > group.examples.length ? (
                <div className="muted">+{group.reports.length - group.examples.length} more</div>
              ) : null}
              <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
                {group.status === 'open' ? (
                  <>
                    <button type="button" onClick={() => void settleChunkIssueReports(group.reports.map((r) => r.id), 'dismissed')}>
                      Not an issue
                    </button>
                    <button type="button" onClick={() => void settleChunkIssueReports(group.reports.map((r) => r.id), 'resolved')}>
                      Mark resolved
                    </button>
                  </>
                ) : (
                  <span className="muted">{group.status === 'dismissed' ? 'Dismissed' : 'Resolved'}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

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
      <ReadingChecksSection />
      <ChunkIssuesSection />
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Sync &amp; analysis issues</h2>
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
                {report.diagnostics ? (
                  <details>
                    <summary className="muted">Captured diagnostics</summary>
                    <pre className="conflict-pre">{report.diagnostics}</pre>
                  </details>
                ) : null}
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
