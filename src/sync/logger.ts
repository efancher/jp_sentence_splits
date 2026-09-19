import { APP_VERSION } from '../appConfig';
import { SYNC_SCHEMA_VERSION, type SyncQueueItem } from './types';

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

/** One still-unpushed mutation, described by ids only (no content) so a report shows *which* records are stuck and why. */
export interface DiagnosticsQueueSummary {
  entity: string;
  recordId: string;
  operation: string;
  retryCount: number;
  lastError: string | null;
  /**
   * The ids/discriminators this record points at (`sentenceId`, `grammarPatternId`,
   * `subjectId`…) — what a foreign-key or row-level-security failure is *about*.
   * Only string fields named `…Id` plus `subjectType`/`activityType`; never text.
   */
  refs: Record<string, string>;
}

const QUEUE_REF_KEYS = new Set(['subjectType', 'activityType']);

/** Compact, content-free description of a queued mutation for the diagnostics snapshot. */
export function summarizePendingItem(item: SyncQueueItem): DiagnosticsQueueSummary {
  const refs: Record<string, string> = {};
  const payload = item.payload;
  if (payload && typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (typeof value === 'string' && (/Id$/.test(key) || QUEUE_REF_KEYS.has(key)) && key !== 'id') {
        refs[key] = value;
      }
    }
  }
  return {
    entity: item.entity,
    recordId: item.recordId,
    operation: item.operation,
    retryCount: item.retryCount,
    lastError: item.lastError ? item.lastError.slice(0, 200) : null,
    refs,
  };
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
  /**
   * The unpushed queue, capped, so "N pending" says *what* is pending. Added
   * 2026-09-19: a report of "4 pending, row-level security violation" couldn't
   * be diagnosed because neither the failing records nor their referenced ids
   * were in the snapshot.
   */
  pendingQueue?: DiagnosticsQueueSummary[];
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
      pendingQueue: (input.pendingQueue ?? []).slice(0, 30),
      lastSyncAt: input.lastSyncAt ?? null,
      lastError: input.lastError ?? null,
      status: input.status,
      signedIn: Boolean(input.userId),
      // `details` (already token/password-redacted by sanitizeDetails) carries the
      // failing entity, recordId and server message for each PUSH_FAIL — without it
      // the log only said *that* a push failed.
      recentLogs: recentEvents.slice(-30).map((e) => ({
        level: e.level,
        message: e.message,
        code: e.code,
        details: e.details,
        at: e.at,
      })),
    },
    null,
    2,
  );
}
