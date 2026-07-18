import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { APP_NAME, APP_VERSION } from '../appConfig';
import { readSettings } from '../db/database';
import {
  exportFullBackup,
  restoreBackup,
  updateSettings,
} from '../db/repository';
import { parseBackupJson } from '../lib/backup';
import { downloadText } from '../lib/worksheet';
import { useTheme } from '../hooks/useTheme';

export function SettingsPage() {
  const settings = useLiveQuery(() => readSettings(), []);
  const { theme, setTheme } = useTheme();
  const [backupPreview, setBackupPreview] = useState<string>('');
  const [backupErrors, setBackupErrors] = useState<string[]>([]);
  const [pendingBackup, setPendingBackup] = useState<ReturnType<
    typeof parseBackupJson
  > | null>(null);
  const [message, setMessage] = useState('');

  if (!settings) return <p className="muted">Loading settings…</p>;

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Settings</h2>
        <p className="muted" style={{ margin: 0 }}>
          {APP_NAME} v{APP_VERSION}. Study data stays in this browser.
        </p>
        <label>
          Theme
          <select
            value={theme}
            onChange={(event) => void setTheme(event.target.value as typeof theme)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.hideSatoriEnglishInitially}
            onChange={(event) =>
              void updateSettings({
                hideSatoriEnglishInitially: event.target.checked,
              })
            }
          />
          Hide Satori English initially
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.showReadingsInitially}
            onChange={(event) =>
              void updateSettings({
                showReadingsInitially: event.target.checked,
              })
            }
          />
          Show readings initially
        </label>
        <label>
          Default text display
          <select
            value={settings.textDisplayMode}
            onChange={(event) =>
              void updateSettings({
                textDisplayMode: event.target.value as typeof settings.textDisplayMode,
              })
            }
          >
            <option value="plain">Plain Japanese</option>
            <option value="furigana">Furigana</option>
            <option value="reading">Reading-only kana</option>
          </select>
        </label>
        <label>
          Default import destination
          <select
            value={settings.defaultImportDestination}
            onChange={(event) =>
              void updateSettings({
                defaultImportDestination: event.target
                  .value as typeof settings.defaultImportDestination,
              })
            }
          >
            <option value="inbox">Inbox</option>
            <option value="new_book">New book</option>
            <option value="existing_book">Existing book</option>
          </select>
        </label>
      </section>

      <section className="panel stack">
        <h3 style={{ margin: 0 }}>Help</h3>
        <p className="muted" style={{ margin: 0 }}>
          Read the workflow guide for importing, organizing, analyzing,
          practicing, and protecting your local data.
        </p>
        <Link to="/help">
          <button type="button">Open user guide</button>
        </Link>
      </section>

      <section className="panel stack">
        <h3 style={{ margin: 0 }}>Backup & restore</h3>
        <p className="muted" style={{ margin: 0 }}>
          Browser-local data does not sync between iPhone and iPad automatically.
          Export a backup to move work between devices.
        </p>
        <button
          type="button"
          className="primary"
          onClick={async () => {
            const payload = await exportFullBackup();
            downloadText(
              `satori-glossbook-backup-${payload.exportedAt.slice(0, 10)}.json`,
              JSON.stringify(payload, null, 2),
              'application/json',
            );
            setMessage('Backup downloaded.');
          }}
        >
          Export all data
        </button>
        <label>
          Import backup JSON
          <input
            type="file"
            accept="application/json,.json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const text = await file.text();
              const parsed = parseBackupJson(text);
              setPendingBackup(parsed);
              if (!parsed.ok) {
                setBackupErrors(parsed.errors);
                setBackupPreview('');
              } else {
                setBackupErrors([]);
                setBackupPreview(
                  `${parsed.data.counts.books} books · ${parsed.data.counts.sentences} sentences · ${parsed.data.counts.analyses} analyses · exported ${parsed.data.exportedAt}`,
                );
              }
            }}
          />
        </label>
        {backupPreview ? <div>{backupPreview}</div> : null}
        {backupErrors.length ? (
          <div style={{ color: 'var(--danger)' }}>
            {backupErrors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        ) : null}
        {pendingBackup?.ok ? (
          <div className="row">
            <button
              type="button"
              onClick={async () => {
                await restoreBackup(pendingBackup.data, 'merge');
                setMessage('Backup merged.');
              }}
            >
              Merge into existing data
            </button>
            <button
              type="button"
              className="danger"
              onClick={async () => {
                const confirmed = window.confirm(
                  'Replace ALL local data with this backup? This cannot be undone.',
                );
                if (!confirmed) return;
                await restoreBackup(pendingBackup.data, 'replace');
                setMessage('Local data replaced from backup.');
              }}
            >
              Replace all local data
            </button>
          </div>
        ) : null}
        {message ? <div className="status-pill complete">{message}</div> : null}
      </section>
    </div>
  );
}
