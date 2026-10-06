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

import {
  emptyAssistRunState,
  runAssistPipeline,
  type AssistRunSpec,
  type AssistRunState,
} from '../src/lib/assistRun';

const API_BASE = (process.env.MINING_API_SELF_BASE ?? 'http://127.0.0.1:8003').replace(/\/$/, '');
const POLL_MS = 2000;
const MAX_WAIT_MS = 15 * 60 * 1000;

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

async function runAssist(prompt: string): Promise<{ reply: string; backend: string | null }> {
  const created = await fetch(`${API_BASE}/assist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!created.ok) throw new Error(`Failed to start assistant: ${await readError(created)}`);
  const { assistId } = (await created.json()) as { assistId: string };
  const startedAt = Date.now();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (cancelled) throw new Error('Cancelled');
    if (Date.now() - startedAt > MAX_WAIT_MS) throw new Error('Assistant timed out');
    const response = await fetch(`${API_BASE}/assist/${assistId}`);
    if (!response.ok) throw new Error(`Assistant status check failed: ${await readError(response)}`);
    const status = (await response.json()) as {
      status: string;
      reply?: string | null;
      backend?: string | null;
      error?: string | null;
    };
    if (status.status === 'error') throw new Error(status.error ?? 'Assistant failed');
    if (status.status === 'done') return { reply: status.reply ?? '', backend: status.backend ?? null };
  }
}

async function main(): Promise<void> {
  const spec = JSON.parse(readFileSync(join(dir!, 'spec.json'), 'utf8')) as AssistRunSpec;
  let state = emptyAssistRunState();
  try {
    state = { ...state, ...(JSON.parse(readFileSync(join(dir!, 'state.json'), 'utf8')) as AssistRunState) };
  } catch {
    // first run: no state yet
  }
  try {
    await runAssistPipeline({ spec, state, run: runAssist, save: saveState, isCancelled: () => cancelled });
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
