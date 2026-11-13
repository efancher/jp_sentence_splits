/**
 * Compare assistant models on the same extras prompts (docs/ASSIST_MODEL_EVAL_PLAN.md).
 * Run it on the box, next to the mining API (`/assist` takes a per-request model).
 *
 *   sample  Read-only Supabase read; picks windows of 10 consecutive sentences rich in
 *           tricky constructions and writes them to a JSON file.
 *             npx tsx scripts/assist-model-eval.ts sample --out eval/windows.json [--count 3] [--per-source 2]
 *   run     Sends each window's extras prompt to each arm; appends to <dir>/results.jsonl
 *           (re-running skips finished runs) and prints a per-arm summary.
 *             npx tsx scripts/assist-model-eval.ts run --windows eval/windows.json --dir eval/run1
 *               [--kinds structure,particles] [--arms A-haiku,B-glm-5.3] [--api http://127.0.0.1:8003]
 *               [--pause 30]   seconds to wait between calls, to stay under a rolling plan limit
 *           Errors and fallbacks are not recorded (a later run retries them); three in a row stop the run.
 *   report  Re-prints the summary and writes <dir>/blind.md (shuffled replies to judge) and
 *           <dir>/blind-key.json (which letter was which arm; look only after judging).
 *             npx tsx scripts/assist-model-eval.ts report --dir eval/run1
 *
 * A reply that came from a fallback backend instead of the requested arm is never scored, so a
 * quota or outage cannot pass for a model result (or count against one).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  DEFAULT_ARMS,
  blindSheet,
  checkReply,
  pickWindows,
  summarize,
  windowPrompt,
  type EvalArm,
  type EvalResult,
  type EvalWindow,
} from '../src/lib/assistModelEval';
import type { ExtraKind } from '../src/lib/combinedImportPrompt';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const POLL_MS = 2000;
const MAX_WAIT_MS = 15 * 60 * 1000;
const MAX_INFRA_FAILURES = 3;

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function need(name: string): string {
  const value = flag(name);
  if (!value) {
    console.error(`Missing --${name}`);
    process.exit(2);
  }
  return value;
}

async function sample(): Promise<void> {
  const out = need('out');
  const count = Number(flag('count', '3'));
  const perSource = Number(flag('per-source', '2'));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const sentences = new Map(
    (
      await fetchAll(supabase, 'sentences', 'id, japanese, translation', user.id, (row) => ({
        id: String(row.id),
        japanese: String(row.japanese ?? ''),
        translation: String(row.translation ?? ''),
      }))
    ).map((row) => [row.id, row]),
  );
  const titles = new Map(
    (
      await fetchAll(supabase, 'books', 'id, title', user.id, (row) => ({
        id: String(row.id),
        title: String(row.title ?? ''),
      }))
    ).map((row) => [row.id, row.title]),
  );
  const links = await fetchAll(supabase, 'book_sentences', 'book_id, sentence_id, position', user.id, (row) => ({
    bookId: String(row.book_id),
    sentenceId: String(row.sentence_id),
    position: Number(row.position ?? 0),
  }));
  const byBook = new Map<string, typeof links>();
  for (const link of links) byBook.set(link.bookId, [...(byBook.get(link.bookId) ?? []), link]);
  const sources = [...byBook].map(([bookId, rows]) => ({
    source: titles.get(bookId) ?? bookId,
    sentences: rows
      .sort((a, b) => a.position - b.position)
      .map((row) => sentences.get(row.sentenceId))
      .filter((row): row is NonNullable<typeof row> => !!row),
  }));
  const windows = pickWindows(sources, count, perSource);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(windows, null, 2));
  for (const window of windows) {
    console.log(`${window.id}  [${window.categories.join(', ')}]  ${window.sentences[0]!.japanese}`);
  }
  console.log(`\nWrote ${windows.length} windows (${windows.length * 10} sentences) to ${out}`);
}

async function ask(api: string, prompt: string, arm: EvalArm): Promise<{ reply: string | null; backend: string | null; error: string | null }> {
  const created = await fetch(`${api}/assist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, backend: arm.backend, model: arm.model, effort: arm.effort }),
  });
  if (!created.ok) return { reply: null, backend: null, error: `HTTP ${created.status}: ${await created.text()}` };
  const { assistId } = (await created.json()) as { assistId: string };
  const started = Date.now();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (Date.now() - started > MAX_WAIT_MS) return { reply: null, backend: null, error: 'timed out' };
    const status = (await (await fetch(`${api}/assist/${assistId}`)).json()) as {
      status: string;
      reply?: string | null;
      backend?: string | null;
      error?: string | null;
    };
    if (status.status === 'done') return { reply: status.reply ?? '', backend: status.backend ?? null, error: null };
    if (status.status === 'error') return { reply: null, backend: status.backend ?? null, error: status.error ?? 'error' };
  }
}

function readResults(dir: string): EvalResult[] {
  const file = join(dir, 'results.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvalResult);
}

function printSummary(results: EvalResult[]): void {
  console.table(
    summarize(results).map((row) => ({ ...row, passRate: `${Math.round(row.passRate * 100)}%` })),
  );
}

async function run(): Promise<void> {
  const windows = JSON.parse(readFileSync(need('windows'), 'utf8')) as EvalWindow[];
  const dir = need('dir');
  const api = (flag('api') ?? process.env.MINING_API_SELF_BASE ?? 'http://127.0.0.1:8003').replace(/\/$/, '');
  const kinds = (flag('kinds', 'structure,particles,comprehension') as string).split(',') as ExtraKind[];
  const wanted = flag('arms')?.split(',');
  const arms = DEFAULT_ARMS.filter((arm) => !wanted || wanted.includes(arm.id));
  if (arms.length === 0) {
    console.error(`No matching arms. Available: ${DEFAULT_ARMS.map((arm) => arm.id).join(', ')}`);
    process.exit(2);
  }
  mkdirSync(dir, { recursive: true });
  const results = readResults(dir);
  const done = new Set(results.map((row) => `${row.window}|${row.kind}|${row.arm}`));
  const pauseSeconds = Number(flag('pause', '0'));
  let infraFailures = 0;
  stop: for (const window of windows) {
    for (const kind of kinds) {
      const prompt = windowPrompt(window, kind);
      for (const arm of arms) {
        if (done.has(`${window.id}|${kind}|${arm.id}`)) continue;
        const started = Date.now();
        const answer = await ask(api, prompt, arm);
        const seconds = Math.round((Date.now() - started) / 1000);
        let problem = answer.error;
        if (!problem && answer.backend !== arm.backend) problem = `fell back to ${answer.backend}`;
        // An error or fallback says nothing about the model (usually a plan limit): don't record it,
        // so a later run retries it, and stop after a few in a row instead of burning the allowance.
        if (problem) {
          console.log(`SKIP ${window.id} ${kind} ${arm.id} ${seconds}s — ${problem}`);
          if (++infraFailures >= MAX_INFRA_FAILURES) {
            console.error(`Stopping after ${infraFailures} errors/fallbacks in a row; re-run later to resume.`);
            break stop;
          }
          continue;
        }
        infraFailures = 0;
        problem = checkReply(window, kind, answer.reply ?? '');
        const row: EvalResult = {
          window: window.id,
          kind,
          arm: arm.id,
          ok: problem === null,
          seconds,
          problem,
          reply: answer.reply,
        };
        appendFileSync(join(dir, 'results.jsonl'), `${JSON.stringify(row)}\n`);
        results.push(row);
        console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${window.id} ${kind} ${arm.id} ${seconds}s${problem ? ` — ${problem}` : ''}`);
        if (pauseSeconds > 0) await new Promise((resolve) => setTimeout(resolve, pauseSeconds * 1000));
      }
    }
  }
  printSummary(results);
}

function report(): void {
  const dir = need('dir');
  const results = readResults(dir);
  printSummary(results);
  const { sheet, key } = blindSheet(results);
  writeFileSync(join(dir, 'blind.md'), sheet);
  writeFileSync(join(dir, 'blind-key.json'), JSON.stringify(key, null, 2));
  console.log(`Wrote ${join(dir, 'blind.md')} (judge this first) and blind-key.json (arm per letter).`);
}

const command = process.argv[2];
const main = command === 'sample' ? sample() : command === 'run' ? run() : command === 'report' ? Promise.resolve(report()) : null;
if (!main) {
  console.error('Usage: assist-model-eval.ts <sample|run|report> ... (see the file header)');
  process.exit(2);
}
main.catch((error) => {
  console.error(error);
  process.exit(1);
});
