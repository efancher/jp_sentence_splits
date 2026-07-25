import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { useAuth } from './auth';
import { runSyncCycle } from './engine';
import { buildDiagnosticsSnapshot } from './logger';
import { needsMigrationPrompt } from './migration';
import {
  ensureSyncMeta,
  listOpenConflicts,
  openConflictCount,
  pendingCount,
  readSyncMeta,
  updateSyncMeta,
} from './queue';
import { setSyncRequestHandler } from './track';
import type { SyncStatus } from './types';

const SYNC_DEBOUNCE_MS = 800;
/** How long to wait before automatically retrying a stuck pending/error queue. */
const AUTO_RETRY_MS = 30_000;
const COUNTDOWN_TICK_MS = 1_000;

interface SyncContextValue {
  status: SyncStatus;
  pending: number;
  conflicts: number;
  lastSyncAt?: string;
  lastError?: string;
  online: boolean;
  /** Seconds until the next automatic sync retry, when one is scheduled. */
  retryInSeconds: number | null;
  syncNow: () => Promise<void>;
  syncReferenceAudio: boolean;
  wifiOnlyAudioDownload: boolean;
  setSyncReferenceAudio: (value: boolean) => Promise<void>;
  setWifiOnlyAudioDownload: (value: boolean) => Promise<void>;
  copyDiagnostics: () => Promise<string>;
  migrationOpen: boolean;
  setMigrationOpen: (open: boolean) => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

function deriveStatus(input: {
  configured: boolean;
  userId?: string;
  online: boolean;
  syncing: boolean;
  pending: number;
  conflicts: number;
  lastError?: string;
}): SyncStatus {
  if (!input.configured) return 'local_only';
  if (!input.userId) return 'signed_out';
  if (!input.online) return 'offline';
  if (input.conflicts > 0) return 'conflict';
  if (input.syncing) return 'syncing';
  if (input.lastError) return 'error';
  if (input.pending > 0) return 'pending';
  return 'synced';
}

function secondsUntil(deadlineMs: number | null, nowMs: number): number | null {
  if (deadlineMs == null) return null;
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [syncing, setSyncing] = useState(false);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [nextRetryAt, setNextRetryAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const meta = useLiveQuery(() => readSyncMeta(), []);
  const pending = useLiveQuery(() => pendingCount(), []) ?? 0;
  const conflicts = useLiveQuery(() => openConflictCount(), []) ?? 0;

  useEffect(() => {
    void ensureSyncMeta();
  }, []);

  const clearAutoRetry = useCallback(() => {
    if (autoRetryRef.current) {
      clearTimeout(autoRetryRef.current);
      autoRetryRef.current = null;
    }
    setNextRetryAt(null);
  }, []);

  const syncNow = useCallback(async () => {
    if (!auth.user || !online) return;
    clearAutoRetry();
    setSyncing(true);
    try {
      await runSyncCycle();
    } finally {
      setSyncing(false);
    }
  }, [auth.user, online, clearAutoRetry]);

  const scheduleSync = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    clearAutoRetry();
    debounceRef.current = setTimeout(() => {
      void syncNow();
    }, SYNC_DEBOUNCE_MS);
  }, [syncNow, clearAutoRetry]);

  useEffect(() => {
    setSyncRequestHandler(scheduleSync);
    return () => setSyncRequestHandler(null);
  }, [scheduleSync]);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void syncNow();
    };
    const onOffline = () => {
      setOnline(false);
      clearAutoRetry();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [syncNow, clearAutoRetry]);

  useEffect(() => {
    if (!auth.user) return;
    void (async () => {
      const needs = await needsMigrationPrompt(auth.user!.id);
      if (needs) {
        setMigrationOpen(true);
        return;
      }
      await syncNow();
    })();
  }, [auth.user, syncNow]);

  const needsAutoRetry =
    Boolean(auth.user) &&
    online &&
    !syncing &&
    conflicts === 0 &&
    (pending > 0 || Boolean(meta?.lastError));

  // Schedule a visible countdown + automatic retry while work remains queued.
  useEffect(() => {
    if (!needsAutoRetry) {
      clearAutoRetry();
      return;
    }
    if (autoRetryRef.current != null) return;

    const deadline = Date.now() + AUTO_RETRY_MS;
    setNextRetryAt(deadline);
    autoRetryRef.current = setTimeout(() => {
      autoRetryRef.current = null;
      setNextRetryAt(null);
      void syncNow();
    }, AUTO_RETRY_MS);

    return () => {
      // Only tear down on unmount; live retries are cleared via clearAutoRetry.
    };
  }, [needsAutoRetry, syncNow, clearAutoRetry]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (autoRetryRef.current) {
        clearTimeout(autoRetryRef.current);
        autoRetryRef.current = null;
      }
    };
  }, []);

  // Tick the countdown display once per second while a retry is pending.
  useEffect(() => {
    if (nextRetryAt == null) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), COUNTDOWN_TICK_MS);
    return () => clearInterval(id);
  }, [nextRetryAt]);

  const retryInSeconds = secondsUntil(nextRetryAt, nowMs);

  const status = deriveStatus({
    configured: auth.configured,
    userId: auth.user?.id,
    online,
    syncing,
    pending,
    conflicts,
    lastError: meta?.lastError,
  });

  const setSyncReferenceAudio = useCallback(async (value: boolean) => {
    await updateSyncMeta({ syncReferenceAudio: value });
  }, []);

  const setWifiOnlyAudioDownload = useCallback(async (value: boolean) => {
    await updateSyncMeta({ wifiOnlyAudioDownload: value });
  }, []);

  const copyDiagnostics = useCallback(async () => {
    const open = await listOpenConflicts();
    const text = buildDiagnosticsSnapshot({
      online,
      pendingCount: pending,
      conflictCount: open.length,
      lastSyncAt: meta?.lastSyncAt,
      lastError: meta?.lastError,
      status,
      userId: auth.user?.id,
    });
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore clipboard failures
    }
    return text;
  }, [online, pending, meta?.lastSyncAt, meta?.lastError, status, auth.user?.id]);

  const value = useMemo<SyncContextValue>(
    () => ({
      status,
      pending,
      conflicts,
      lastSyncAt: meta?.lastSyncAt,
      lastError: meta?.lastError,
      online,
      retryInSeconds,
      syncNow,
      syncReferenceAudio: meta?.syncReferenceAudio ?? false,
      wifiOnlyAudioDownload: meta?.wifiOnlyAudioDownload ?? true,
      setSyncReferenceAudio,
      setWifiOnlyAudioDownload,
      copyDiagnostics,
      migrationOpen,
      setMigrationOpen,
    }),
    [
      status,
      pending,
      conflicts,
      meta?.lastSyncAt,
      meta?.lastError,
      meta?.syncReferenceAudio,
      meta?.wifiOnlyAudioDownload,
      online,
      retryInSeconds,
      syncNow,
      setSyncReferenceAudio,
      setWifiOnlyAudioDownload,
      copyDiagnostics,
      migrationOpen,
    ],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used within SyncProvider');
  return ctx;
}
