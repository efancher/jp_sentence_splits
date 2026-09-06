import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import {
  APP_NAME,
  APP_VERSION,
  TTS_RATE_PRESETS,
  TTS_TEST_SENTENCE,
} from '../appConfig';
import { AuthAndSyncSettings } from '../components/AuthAndSyncSettings';
import {
  DEFAULT_TTS_SETTINGS,
  getDb,
  readSettings,
} from '../db/database';
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
import { clearDownloadedAudioCache } from '../sync/audioSync';
import { useSync } from '../sync/SyncProvider';
const BYTES_PER_MEBIBYTE = 1024 * 1024;

/**
 * Two-step inline confirm for a destructive action — replaces `window.confirm`,
 * which silently no-ops on an installed iOS Safari PWA (same reason the
 * Analyze/BookDetail confirms are inline). First press arms; a second,
 * explicit press runs it.
 */
function ConfirmButton({
  label,
  confirmLabel = 'Confirm',
  prompt,
  className = 'danger',
  onConfirm,
}: {
  label: string;
  confirmLabel?: string;
  prompt: string;
  className?: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!armed) {
    return (
      <button type="button" className={className} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }

  return (
    <div className="stack" style={{ gap: '0.35rem' }}>
      <p className="muted" role="alert" style={{ margin: 0 }}>
        {prompt}
      </p>
      <div className="row">
        <button
          type="button"
          className={className}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
              setArmed(false);
            }
          }}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={() => setArmed(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const settings = useLiveQuery(() => readSettings(), []);
  const sync = useSync();
  const nativeAudioSummary = useLiveQuery(async () => {
    const records = await getDb().sentenceAudio.toArray();
    return {
      count: records.length,
      bytes: records.reduce((total, record) => total + record.blob.size, 0),
    };
  }, []);
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
          {APP_NAME} v{APP_VERSION}. Study data stays in this browser first;
          optional Supabase sync keeps devices aligned when configured.
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
        <label>
          New cards per review session
          <input
            type="number"
            min={0}
            step={1}
            value={settings.newCardsPerSessionLimit}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              if (Number.isNaN(parsed) || parsed < 0) return;
              void updateSettings({ newCardsPerSessionLimit: parsed });
            }}
          />
        </label>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Caps how many never-before-seen words/sentences Review introduces
          in one sitting — already-due reviews are never capped by this.
        </p>
        <label>
          Graduate after this many days between reviews
          <input
            type="number"
            min={0}
            step={1}
            value={settings.graduationMinScheduledDays}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              if (Number.isNaN(parsed) || parsed < 0) return;
              void updateSettings({ graduationMinScheduledDays: parsed });
            }}
          />
        </label>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Once a word or sentence's review interval grows past this many
          days, it stops being quizzed — the scheduler's own signal that
          you've retained it long-term. Set to 0 to disable (nothing ever
          retires).
        </p>
      </section>

      <section className="panel stack">
        <h3 style={{ margin: 0 }}>Learning Orchestrator</h3>
        <label>
          Daily session length (minutes)
          <input
            type="number"
            min={5}
            step={5}
            value={settings.dailyBudgetMinutes}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              if (Number.isNaN(parsed) || parsed <= 0) return;
              void updateSettings({ dailyBudgetMinutes: parsed });
            }}
          />
        </label>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          How many minutes the "Start" button on Today plans for. The "+more
          time" top-up buttons stay fixed regardless of this. The activity
          split (glossing/grammar/shadowing/review) is set on Home, right
          before adding time, not here.
        </p>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.quietMode ?? false}
            onChange={(event) => {
              void updateSettings({ quietMode: event.target.checked });
            }}
          />
          Quiet mode (can&rsquo;t speak aloud)
        </label>
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Pauses everything that needs you to talk: new sessions skip
          shadowing steps (they come back when you turn this off), the
          pitch-accent drill runs perception-only, and Shadowing shows a
          reminder instead of blocking. Per-device, and also toggleable on
          Home.
        </p>
      </section>

      <AuthAndSyncSettings />

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
        <h3 style={{ margin: 0 }}>Storage</h3>
        {nativeAudioSummary?.count ? (
          <p className="muted" style={{ margin: 0 }}>
            {nativeAudioSummary.count} imported native clip(s) use about{' '}
            {(nativeAudioSummary.bytes / BYTES_PER_MEBIBYTE).toFixed(1)} MB
            locally.
          </p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            No native audio clips cached on this device.
          </p>
        )}
        <ConfirmButton
          label="Clear audio cache"
          confirmLabel="Clear audio cache"
          className="ghost"
          prompt="Clear downloaded/imported reference audio from this device? Study data is untouched."
          onConfirm={async () => {
            const count = await clearDownloadedAudioCache();
            setMessage(`Cleared ${count} audio clip(s) from this device.`);
          }}
        />
        <ConfirmButton
          label="Remove local data from this device"
          confirmLabel="Remove local data"
          prompt="Remove ALL local study data from this device? A backup downloads first."
          onConfirm={async () => {
            const payload = await exportFullBackup();
            downloadText(
              `satori-glossbook-before-clear-${payload.exportedAt.slice(0, 10)}.json`,
              JSON.stringify(payload, null, 2),
              'application/json',
            );
            const db = getDb();
            await db.transaction(
              'rw',
              [
                db.books,
                db.sentences,
                db.bookSentences,
                db.analyses,
                db.importBatches,
                db.inbox,
                db.sentenceAudio,
                db.syncQueue,
                db.syncRecordMeta,
                db.syncConflicts,
              ],
              async () => {
                await db.books.clear();
                await db.sentences.clear();
                await db.bookSentences.clear();
                await db.analyses.clear();
                await db.importBatches.clear();
                await db.inbox.clear();
                await db.sentenceAudio.clear();
                await db.syncQueue.clear();
                await db.syncRecordMeta.clear();
                await db.syncConflicts.clear();
              },
            );
            setMessage('Local study data cleared. Backup downloaded.');
            await sync.syncNow();
          }}
        />
      </section>

      <section className="panel stack">
        <h3 style={{ margin: 0 }}>Backup & restore</h3>
        <p className="muted" style={{ margin: 0 }}>
          JSON backups are independent of Supabase. Export regularly. With sync
          enabled, devices share cloud data; backups remain the portable
          safety net.
        </p>
        {nativeAudioSummary?.count ? (
          <p className="muted" style={{ margin: 0 }}>
            {nativeAudioSummary.count} imported native clip(s) use about{' '}
            {(nativeAudioSummary.bytes / BYTES_PER_MEBIBYTE).toFixed(1)} MB.
            Clips
            are not included in JSON backups; retain and reimport their
            shadowing project ZIPs.
          </p>
        ) : null}
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
            <ConfirmButton
              label="Replace all local data"
              confirmLabel="Replace all local data"
              prompt="Replace ALL local data with this backup? This cannot be undone."
              onConfirm={async () => {
                await restoreBackup(pendingBackup.data, 'replace');
                setMessage('Local data replaced from backup.');
              }}
            />
          </div>
        ) : null}
        {message ? <div className="status-pill complete">{message}</div> : null}
      </section>
    </div>
  );
}
