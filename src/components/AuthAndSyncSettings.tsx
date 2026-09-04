import { useState } from 'react';

import { exportFullBackup, reportSyncIssue } from '../db/repository';
import { downloadText } from '../lib/worksheet';
import { useAuth } from '../sync/auth';
import { replaceLocalWithCloud } from '../sync/engine';
import { useSync } from '../sync/SyncProvider';
import { ConflictPanel } from './ConflictPanel';
import { isSupabaseConfigured } from '../sync/supabaseClient';

type AuthMode = 'signin' | 'signup' | 'reset';

export function AuthAndSyncSettings() {
  const auth = useAuth();
  const sync = useSync();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRedownload, setConfirmRedownload] = useState(false);
  const [reportingSyncIssue, setReportingSyncIssue] = useState(false);
  const [syncIssueNote, setSyncIssueNote] = useState('');
  const [submittingSyncIssue, setSubmittingSyncIssue] = useState(false);
  const [syncIssueReported, setSyncIssueReported] = useState(false);

  if (!isSupabaseConfigured()) {
    return (
      <section className="panel stack">
        <h3 style={{ margin: 0 }}>Cloud sync</h3>
        <p className="muted" style={{ margin: 0 }}>
          Supabase is not configured. Copy <code>.env.example</code> to{' '}
          <code>.env</code> and set <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code>. The app continues to work
          local-only.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="panel stack">
        <h3 style={{ margin: 0 }}>Account & sync</h3>
        <p className="muted" style={{ margin: 0 }}>
          Status: <strong>{sync.status}</strong>
          {sync.lastSyncAt
            ? ` · last sync ${new Date(sync.lastSyncAt).toLocaleString()}`
            : ''}
          {sync.pending ? ` · ${sync.pending} pending` : ''}
        </p>
        {sync.lastError ? (
          <div style={{ color: 'var(--danger)' }}>{sync.lastError}</div>
        ) : null}

        {auth.user ? (
          <>
            <p style={{ margin: 0 }}>
              Signed in as <strong>{auth.user.email}</strong>
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Persistent sessions stay signed in on this browser until you sign
              out. On shared devices, sign out when finished.
            </p>
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={!sync.online || sync.status === 'syncing'}
                onClick={() => void sync.syncNow()}
              >
                Sync now
              </button>
              <button
                type="button"
                onClick={async () => {
                  const text = await sync.copyDiagnostics();
                  setMessage('Diagnostics copied to clipboard.');
                  if (!text) setMessage('Diagnostics ready (clipboard unavailable).');
                }}
              >
                Copy diagnostics
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => void auth.signOut()}
              >
                Sign out
              </button>
            </div>
            {reportingSyncIssue ? (
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!syncIssueNote.trim() || submittingSyncIssue) return;
                  setSubmittingSyncIssue(true);
                  void (async () => {
                    try {
                      const diagnostics = await sync.copyDiagnostics();
                      await reportSyncIssue({
                        note: syncIssueNote.trim(),
                        diagnosticsSnapshot: diagnostics,
                      });
                      setReportingSyncIssue(false);
                      setSyncIssueNote('');
                      setSyncIssueReported(true);
                    } finally {
                      setSubmittingSyncIssue(false);
                    }
                  })();
                }}
              >
                <textarea
                  value={syncIssueNote}
                  onChange={(event) => setSyncIssueNote(event.target.value)}
                  placeholder="What looks wrong with sync? (e.g. seeing way more conflicts than expected)"
                  rows={3}
                  autoFocus
                />
                <div className="row">
                  <button
                    type="submit"
                    disabled={!syncIssueNote.trim() || submittingSyncIssue}
                  >
                    Submit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReportingSyncIssue(false);
                      setSyncIssueNote('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <button
                  type="button"
                  onClick={() => {
                    setSyncIssueReported(false);
                    setReportingSyncIssue(true);
                  }}
                >
                  Report sync issue
                </button>
                {syncIssueReported ? (
                  <span className="muted">
                    ✓ Reported — includes a diagnostics snapshot for later triage.
                  </span>
                ) : null}
              </div>
            )}
            <label className="row">
              <input
                type="checkbox"
                checked={sync.syncReferenceAudio}
                onChange={(event) =>
                  void sync.setSyncReferenceAudio(event.target.checked)
                }
              />
              Sync reference audio to cloud storage
            </label>
            {sync.syncReferenceAudio ? (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const { resyncReferenceAudio } = await import('../sync/audioSync');
                    const count = await resyncReferenceAudio();
                    setMessage(
                      `Reference audio: ${count} clip(s) available for this account. ` +
                        'Any not yet on this device download in the background.',
                    );
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Audio re-sync failed.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Download all reference audio now
              </button>
            ) : null}
            <label className="row">
              <input
                type="checkbox"
                checked={sync.wifiOnlyAudioDownload}
                onChange={(event) =>
                  void sync.setWifiOnlyAudioDownload(event.target.checked)
                }
              />
              Download audio on Wi‑Fi only (when browser reports connection)
            </label>

            <div className="stack" style={{ gap: '0.35rem' }}>
              <p className="muted" style={{ margin: 0 }}>
                Re-download everything from cloud: replaces this device's study
                data with a fresh full copy from the server. Use if a card,
                word, or grammar pattern shows as missing/deleted here but is
                fine elsewhere. Reference audio and shadowing recordings on this
                device are untouched. A JSON backup downloads first.
              </p>
              {!confirmRedownload ? (
                <button
                  type="button"
                  disabled={busy || !sync.online}
                  onClick={() => {
                    setMessage('');
                    setError('');
                    setConfirmRedownload(true);
                  }}
                >
                  Re-download everything from cloud
                </button>
              ) : (
                <div className="row">
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      setMessage('');
                      try {
                        const payload = await exportFullBackup();
                        downloadText(
                          `satori-glossbook-before-redownload-${payload.exportedAt.slice(0, 10)}.json`,
                          JSON.stringify(payload, null, 2),
                          'application/json',
                        );
                        await replaceLocalWithCloud(auth.user!.id);
                        setMessage(
                          'Re-downloaded all study data from the cloud. Backup saved.',
                        );
                      } catch (err) {
                        setError(
                          err instanceof Error ? err.message : 'Re-download failed.',
                        );
                      } finally {
                        setBusy(false);
                        setConfirmRedownload(false);
                      }
                    }}
                  >
                    {busy ? 'Re-downloading…' : 'Back up & replace now'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmRedownload(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="row">
              <button
                type="button"
                className={mode === 'signin' ? 'primary' : undefined}
                onClick={() => setMode('signin')}
              >
                Sign in
              </button>
              <button
                type="button"
                className={mode === 'signup' ? 'primary' : undefined}
                onClick={() => setMode('signup')}
              >
                Create account
              </button>
              <button
                type="button"
                className={mode === 'reset' ? 'primary' : undefined}
                onClick={() => setMode('reset')}
              >
                Forgot password
              </button>
            </div>
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {mode !== 'reset' ? (
              <label>
                Password
                <input
                  type="password"
                  autoComplete={
                    mode === 'signup' ? 'new-password' : 'current-password'
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            ) : null}
            <button
              type="button"
              className="primary"
              disabled={busy || !email.trim()}
              onClick={async () => {
                setBusy(true);
                setError('');
                setMessage('');
                try {
                  if (mode === 'signin') {
                    const result = await auth.signIn(email, password);
                    if (result.error) setError(result.error);
                    else setMessage('Signed in.');
                  } else if (mode === 'signup') {
                    const result = await auth.signUp(email, password);
                    if (result.error) setError(result.error);
                    else
                      setMessage(
                        'Check your email to confirm the account, then sign in.',
                      );
                  } else {
                    const result = await auth.resetPassword(email);
                    if (result.error) setError(result.error);
                    else setMessage('Password reset email sent.');
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              {mode === 'signin'
                ? 'Sign in'
                : mode === 'signup'
                  ? 'Create account'
                  : 'Send reset email'}
            </button>
          </>
        )}
        {error ? <div style={{ color: 'var(--danger)' }}>{error}</div> : null}
        {message ? <div className="status-pill complete">{message}</div> : null}
      </section>
      <ConflictPanel />
    </>
  );
}
