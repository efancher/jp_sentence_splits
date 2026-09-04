import { APP_VERSION } from '../appConfig';
import { SYNC_SCHEMA_VERSION } from './types';

const isDev = import.meta.env.DEV;

export type SyncLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SyncLogEvent {
  level: SyncLogLevel;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
  at: string;
}

const recentEvents: SyncLogEvent[] = [];
const MAX_EVENTS = 100;

function sanitizeDetails(
  details?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('token') ||
      lower.includes('password') ||
      lower.includes('authorization') ||
      lower.includes('apikey') ||
      lower.includes('refresh')
    ) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function syncLog(
  level: SyncLogLevel,
  message: string,
  code?: string,
  details?: Record<string, unknown>,
): void {
  const event: SyncLogEvent = {
    level,
    message,
    code,
    details: sanitizeDetails(details),
    at: new Date().toISOString(),
  };
  recentEvents.push(event);
  if (recentEvents.length > MAX_EVENTS) recentEvents.shift();
  if (!isDev && level === 'debug') return;
  const payload = { code, ...event.details };
  if (level === 'error') console.error('[sync]', message, payload);
  else if (level === 'warn') console.warn('[sync]', message, payload);
  else if (isDev) console.info('[sync]', message, payload);
}

export function getRecentSyncLogs(): SyncLogEvent[] {
  return [...recentEvents];
}

export interface DiagnosticsConflictSummary {
  entity: string;
  recordId: string;
  localVersion: number;
  remoteVersion: number;
  createdAt: string;
}

export function buildDiagnosticsSnapshot(input: {
  online: boolean;
  pendingCount: number;
  conflictCount: number;
  lastSyncAt?: string;
  lastError?: string;
  status: string;
  userId?: string;
  /**
   * Compact per-conflict summary (no payload contents — those are already
   * visible in ConflictPanel while signed in). Without this, "conflicts"
   * was just a count, which isn't enough to spot a pattern (e.g. one
   * entity conflicting repeatedly) from a report filed elsewhere.
   */
  openConflicts?: DiagnosticsConflictSummary[];
}): string {
  return JSON.stringify(
    {
      appVersion: APP_VERSION,
      syncSchemaVersion: SYNC_SCHEMA_VERSION,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      online: input.online,
      pendingCount: input.pendingCount,
      conflictCount: input.conflictCount,
      openConflicts: input.openConflicts ?? [],
      lastSyncAt: input.lastSyncAt ?? null,
      lastError: input.lastError ?? null,
      status: input.status,
      signedIn: Boolean(input.userId),
      recentLogs: recentEvents.slice(-20).map((e) => ({
        level: e.level,
        message: e.message,
        code: e.code,
        at: e.at,
      })),
    },
    null,
    2,
  );
}
