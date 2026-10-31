/**
 * Box-side runner for a Quick import "Send to assistant" run. Spawned by the
 * mining API (`server/youtube-mining/app/assist_run.py`); not meant to be run
 * by hand except for debugging.
 *
 * Usage: npx tsx scripts/assist-run.ts --dir <run dir>
 *
 * Reads `spec.json` ({ transcript, options }) and, if present, `state.json`
 * from the run directory, runs the pipeline in `src/lib/assistRun.ts`
 * (prompts go to the API's own `/assist` over loopback so the one-at-a-time
 * lock is shared), and rewrites `state.json` atomically after every step.
 * SIGTERM stops the run cleanly after the in-flight assistant call is given
 * up on.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runBookExtrasPipeline, type BookAssistRunSpec } from '../src/lib/bookAssistRun';
import {
  emptyAssistRunState,
  logPatch,
  runAssistPipeline,
  type AssistRunSpec,
  type AssistRunState,
} from '../src/lib/assistRun';

const API_BASE = (process.env.MINING_API_SELF_BASE ?? 'http://127.0.0.1:8003').replace(/\/$/, '');
const POLL_MS = 2000;
// Fallback until the server reports its per-backend limit; the real cap is two backends' worth plus slack.
let maxWaitMs = 15 * 60 * 1000;

const dirIndex = process.argv.indexOf('--dir');
const dir = dirIndex >= 0 ? process.argv[dirIndex + 1] : undefined;
if (!dir) {
  console.error('Usage: assist-run.ts --dir <run dir>');
  process.exit(2);
}

let cancelled = false;
process.on('SIGTERM', () => {
  cancelled = true;
});

function saveState(state: AssistRunState): void {
  const tmp = join(dir!, 'state.json.tmp');
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, join(dir!, 'state.json'));
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    return typeof body.detail === 'string' ? body.detail : `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

let liveState: AssistRunState | null = null;

type LiveInfo = {
  backend: string | null;
  startedAt: number | null;
  timeoutSeconds: number | null;
};
/** Calls in flight (several when the run is parallel), keyed by a per-call token. */
const activeCalls = new Map<symbol, LiveInfo>();

/** Mirrors the oldest call in flight (backend, start time) into the run state. */
function publishLive(): void {
  if (!liveState) return;
  let oldest: LiveInfo | null = null;
  for (const info of activeCalls.values()) {
    if (!oldest || (info.startedAt ?? Infinity) < (oldest.startedAt ?? Infinity)) oldest = info;
  }
  const prev = liveState.live;
  if (prev?.backend === oldest?.backend && prev?.startedAt === oldest?.startedAt) return;
  liveState.live = oldest;
  liveState.updatedAt = Date.now();
  saveState(liveState);
}

function reportLive(token: symbol, info: LiveInfo | null): void {
  if (info) activeCalls.set(token, info);
  else activeCalls.delete(token);
  publishLive();
}

async function runAssist(prompt: string, backend: string): Promise<{ reply: string; backend: string | null }> {
  const token = Symbol('call');
  try {
    return await runAssistCall(prompt, backend, token);
  } finally {
    reportLive(token, null);
  }
}

async function runAssistCall(
  prompt: string,
  backend: string,
  token: symbol,
): Promise<{ reply: string; backend: string | null }> {
  const created = await fetch(`${API_BASE}/assist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, backend }),
  });
  if (!created.ok) throw new Error(`Failed to start assistant: ${await readError(created)}`);
  const { assistId } = (await created.json()) as { assistId: string };
  const startedAt = Date.now();
  let loggedAttempts = 0;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (cancelled) throw new Error('Cancelled');
    if (Date.now() - startedAt > maxWaitMs) throw new Error('Assistant timed out');
    const response = await fetch(`${API_BASE}/assist/${assistId}`);
    if (!response.ok) throw new Error(`Assistant status check failed: ${await readError(response)}`);
    const status = (await response.json()) as {
      status: string;
      reply?: string | null;
      backend?: string | null;
      error?: string | null;
      startedAt?: number | null;
      timeoutSeconds?: number | null;
      attempts?: {
        backend: string;
        outcome: string;
        detail?: string | null;
        seconds: number;
      }[];
    };
    if (status.timeoutSeconds) maxWaitMs = status.timeoutSeconds * 2000 + 2 * 60 * 1000;
    const attempts = status.attempts ?? [];
    if (liveState && attempts.length > loggedAttempts) {
      for (const a of attempts.slice(loggedAttempts)) {
        const text =
          a.outcome === 'ok'
            ? `${a.backend} answered in ${a.seconds}s`
            : `${a.backend} failed after ${a.seconds}s: ${a.detail ?? 'unknown error'}`;
        Object.assign(liveState, logPatch(liveState, text));
      }
      loggedAttempts = attempts.length;
      liveState.updatedAt = Date.now();
      saveState(liveState);
    }
    if (status.status === 'running' && status.backend) {
      reportLive(token, {
        backend: status.backend,
        startedAt: status.startedAt ? Math.round(status.startedAt * 1000) : null,
        timeoutSeconds: status.timeoutSeconds ?? null,
      });
    }
    if (status.status === 'error') throw new Error(status.error ?? 'Assistant failed');
    if (status.status === 'done') return { reply: status.reply ?? '', backend: status.backend ?? null };
  }
}

async function main(): Promise<void> {
  const spec = JSON.parse(readFileSync(join(dir!, 'spec.json'), 'utf8')) as AssistRunSpec & Partial<BookAssistRunSpec>;
  let state = emptyAssistRunState();
  try {
    state = {
      ...state,
      ...(JSON.parse(readFileSync(join(dir!, 'state.json'), 'utf8')) as AssistRunState),
    };
  } catch {
    // first run: no state yet
  }
  liveState = state;
  try {
    const run = (prompt: string) => runAssist(prompt, spec.backend ?? 'auto');
    if (spec.sentences && spec.selection) {
      await runBookExtrasPipeline({
        spec: { sentences: spec.sentences, selection: spec.selection, grammarPatterns: spec.grammarPatterns },
        state,
        run,
        save: saveState,
        isCancelled: () => cancelled,
      });
    } else {
      await runAssistPipeline({
        spec,
        state,
        run,
        save: saveState,
        isCancelled: () => cancelled,
      });
    }
  } catch (err) {
    state.status = 'failed';
    state.progress = '';
    state.failure = err instanceof Error ? err.message : 'The run crashed.';
    state.updatedAt = Date.now();
    saveState(state);
    process.exitCode = 1;
  }
}

void main();
