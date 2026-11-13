/**
 * Score saved model-eval replies with the UniDic cross-checks (src/lib/extraCrossCheck.ts).
 * No model calls. Needs the mining API for /resegment.
 *   npx tsx scripts/assist-extras-crosscheck.ts --windows /tmp/assist-eval/windows.json --dir /tmp/assist-eval/run1 [--api http://127.0.0.1:8003] [--verbose]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkParticleChunk, checkStructureSentence, type CheckToken, type CrossCheckIssue } from '../src/lib/extraCrossCheck';
import { parseBookParticleReply } from '../src/lib/particleReply';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : fallback;
};
const api = opt('api', 'http://127.0.0.1:8003');
const verbose = args.includes('--verbose');

interface Window { id: string; sentences: { handle: number; japanese: string }[] }
const windows: Window[] = JSON.parse(readFileSync(opt('windows', ''), 'utf8'));
const rows = readFileSync(join(opt('dir', ''), 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { window: string; kind: string; arm: string; ok: boolean; reply: string });

async function tokenize(w: Window): Promise<Map<number, CheckToken[]>> {
  const res = await fetch(`${api}/resegment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sentences: w.sentences.map((s, i) => ({ japanese: s.japanese, startMs: i * 1000, endMs: i * 1000 + 900 })), merge: false, split: false }),
  });
  const body = (await res.json()) as { cues?: { tokens?: CheckToken[] }[] } | { tokens?: CheckToken[] }[];
  const cues = Array.isArray(body) ? body : (body.cues ?? []);
  return new Map(w.sentences.map((s, i) => [s.handle, cues[i]?.tokens ?? []]));
}

const tokens = new Map<string, Map<number, CheckToken[]>>();
for (const w of windows) tokens.set(w.id, await tokenize(w));

const stats = new Map<string, { checked: number; bad: number }>();
const bump = (key: string, bad: boolean) => {
  const s = stats.get(key) ?? { checked: 0, bad: 0 };
  s.checked += 1;
  if (bad) s.bad += 1;
  stats.set(key, s);
};

for (const row of rows) {
  const w = windows.find((x) => x.id === row.window);
  if (!w || !row.ok) continue;
  const toks = tokens.get(w.id)!;
  const issues: { handle: number; issue: CrossCheckIssue }[] = [];
  if (row.kind === 'particles') {
    const parsed = parseBookParticleReply(row.reply, w.sentences.length);
    parsed.forEach((checks, i) => {
      const s = w.sentences[i]!;
      for (const c of checks ?? []) {
        const issue = checkParticleChunk(s.japanese, toks.get(s.handle) ?? [], c.chunk);
        bump(`${row.arm} particles`, Boolean(issue));
        if (issue) issues.push({ handle: s.handle, issue });
      }
    });
  } else if (row.kind === 'structure') {
    const byHandle = new Map<number, { chunk: string; role: string }[]>();
    for (const line of row.reply.split('\n')) {
      const m = /^S(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/.exec(line.trim());
      if (m) byHandle.set(Number(m[1]), [...(byHandle.get(Number(m[1])) ?? []), { chunk: m[2]!, role: m[3]! }]);
    }
    for (const s of w.sentences) {
      const lines = byHandle.get(s.handle) ?? [];
      const bad = checkStructureSentence(s.japanese, toks.get(s.handle) ?? [], lines);
      for (let i = 0; i < lines.length; i += 1) bump(`${row.arm} structure`, false);
      for (const issue of bad) {
        issues.push({ handle: s.handle, issue });
        const s2 = stats.get(`${row.arm} structure`)!;
        s2.bad += 1;
      }
    }
  }
  if (verbose) for (const { handle, issue } of issues) console.log(`${row.arm} ${row.kind} S${handle}: ${issue.chunk}${issue.role ? ` [${issue.role}]` : ''} -> ${issue.problem}`);
}

for (const [key, s] of [...stats].sort()) console.log(`${key.padEnd(28)} ${s.bad}/${s.checked} flagged (${((100 * s.bad) / s.checked).toFixed(1)}%)`);
