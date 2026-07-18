import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import {
  APP_NAME,
  APP_VERSION,
  TTS_RATE_PRESETS,
  TTS_TEST_SENTENCE,
} from '../appConfig';
import { DEFAULT_TTS_SETTINGS, readSettings } from '../db/database';
import { useJapaneseSpeech } from '../hooks/useJapaneseSpeech';
import { filterJapaneseVoices } from '../lib/speech';
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
  const speech = useJapaneseSpeech();
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
        <h3 style={{ margin: 0 }}>Text-to-speech</h3>
        {!speech.supported ? (
          <p className="muted" style={{ margin: 0 }}>
            This browser does not support speech synthesis, so Japanese audio
            playback is unavailable.
          </p>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Playback uses the Japanese voices installed on this device. No
              internet service is involved.
            </p>
            <label>
              Japanese voice
              <select
                value={settings.tts.voiceURI ?? ''}
                onChange={(event) => {
                  const uri = event.target.value;
                  const voice = filterJapaneseVoices(speech.voices).find(
                    (item) => item.voiceURI === uri,
                  );
                  void updateSettings({
                    tts: {
                      ...settings.tts,
                      voiceURI: uri || undefined,
                      preferredVoiceName: voice?.name,
                    },
                  });
                }}
              >
                <option value="">Automatic (browser default)</option>
                {filterJapaneseVoices(speech.voices).map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name}
                    {voice.localService ? ' (on device)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {!filterJapaneseVoices(speech.voices).length ? (
              <p className="muted" style={{ margin: 0 }}>
                No Japanese voices are listed yet. Playback still works: the
                browser will pick a Japanese voice automatically.
              </p>
            ) : null}
            <label>
              Speaking rate
              <select
                value={String(settings.tts.rate)}
                onChange={(event) =>
                  void updateSettings({
                    tts: {
                      ...settings.tts,
                      rate: Number.parseFloat(event.target.value),
                    },
                  })
                }
              >
                {TTS_RATE_PRESETS.map((preset) => (
                  <option key={preset.value} value={String(preset.value)}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="row">
              <button
                type="button"
                onClick={() =>
                  speech.speak(TTS_TEST_SENTENCE, { itemId: 'tts-test' })
                }
              >
                Test voice
              </button>
              {speech.isSpeaking ? (
                <button type="button" onClick={() => speech.stop()}>
                  Stop
                </button>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  void updateSettings({ tts: { ...DEFAULT_TTS_SETTINGS } })
                }
              >
                Reset to defaults
              </button>
            </div>
          </>
        )}
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
