import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { reportSyncIssue } from '../db/repository';
import { buildPageSnapshot } from '../lib/pageSnapshot';
import { installErrorCapture } from '../lib/recentErrors';

/**
 * Header-level "Report issue" for any page. Saves a note plus an auto-captured
 * snapshot of what's on screen (route, sentence, selected text, visible page
 * text, recent JS errors) via the sync-issue pipeline, so it can be filed from
 * a machine with no AI access and triaged later from /issues. Inline form, not
 * window.prompt (silently no-ops on installed iOS Safari PWAs).
 */
export function ReportIssueButton() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [selection, setSelection] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => installErrorCapture(), []);
  useEffect(() => {
    setOpen(false);
    setSent(false);
  }, [location.pathname]);

  async function send() {
    if (!note.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      await reportSyncIssue({
        note: note.trim(),
        diagnosticsSnapshot: await buildPageSnapshot(location.pathname, location.search, selection),
        conflictEntity: 'page_report',
        conflictRecordId: location.pathname,
      });
      setNote('');
      setOpen(false);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="ghost"
        aria-expanded={open}
        onClick={() => {
          setSelection(window.getSelection()?.toString().trim().slice(0, 500) ?? '');
          setSent(false);
          setOpen((value) => !value);
        }}
      >
        {sent ? '✓ Reported' : 'Report issue'}
      </button>
      {open ? (
        <form
          className="panel stack"
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            width: 'min(22rem, 90vw)',
            zIndex: 30,
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            aria-label="What looks wrong?"
            placeholder="What looks wrong on this page?"
            rows={4}
            autoFocus
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {selection ? (
            <p className="muted" style={{ margin: 0, fontSize: '0.8em' }}>
              Includes your selected text: “{selection.slice(0, 80)}”
            </p>
          ) : null}
          <p className="muted" style={{ margin: 0, fontSize: '0.8em' }}>
            Also saves the page, sentence and visible text for later triage.
          </p>
          <div className="row" style={{ gap: '0.5rem' }}>
            <button type="submit" className="primary" disabled={!note.trim() || sending}>
              {sending ? 'Saving…' : 'Save report'}
            </button>
            <button type="button" disabled={sending} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          {error ? <p className="muted" style={{ margin: 0 }}>{error}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
