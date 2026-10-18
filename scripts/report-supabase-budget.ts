/** Read-only local snapshot report. No Supabase login, API requests or mutations. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { buildBudgetReport, renderBudgetReport } from './lib/supabaseBudget';

const HELP = `Usage: npm run report:supabase-budget -- --input <snapshot.json> [--output <directory>] [--now <ISO timestamp>] [--check]
Reads a local dashboard snapshot; makes no network requests.
Prints Markdown, or writes report.md and report.json to --output.
--check exits 2 for exceeded/headroom/incomplete budgets; invalid input exits 1.
Template: fixtures/performance/supabase-budget.template.json
Example: fixtures/performance/supabase-budget.example.json (use --now 2026-10-16T00:00:00Z)
`;

export function runBudgetReport(args: string[], out: (text: string) => void = console.log): number {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) { out(HELP); return 0; }
  let input: string | undefined;
  let output: string | undefined;
  let now = new Date();
  let check = false;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (seen.has(flag)) throw new Error(`Repeated option: ${flag}`);
    seen.add(flag);
    if (flag === '--check') { check = true; continue; }
    if (!['--input', '--output', '--now'].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value.`);
    if (flag === '--input') input = value;
    else if (flag === '--output') output = value;
    else {
      // Use the same explicit-timezone validation as snapshot timestamps.
      if (!z.iso.datetime({ offset: true }).safeParse(value).success) throw new Error('--now needs a valid ISO timestamp with a timezone.');
      now = new Date(value);
    }
  }
  if (!input) throw new Error(HELP);
  let snapshot: unknown;
  let contents: string;
  try { contents = readFileSync(input, 'utf8'); } catch { throw new Error('Cannot read the input snapshot.'); }
  try { snapshot = JSON.parse(contents); } catch { throw new Error('Input snapshot is not valid JSON.'); }
  const report = buildBudgetReport(snapshot, now);
  const markdown = renderBudgetReport(report);
  if (output) {
    const paths = ['report.md', 'report.json'].map((name) => resolve(output, name));
    if (paths.includes(resolve(input))) throw new Error('Output would overwrite the input snapshot. Choose a different directory.');
    mkdirSync(output, { recursive: true });
    writeFileSync(paths[0]!, markdown);
    writeFileSync(paths[1]!, JSON.stringify(report, null, 2) + '\n');
    out(`Budget status: ${report.status}. Reports: ${paths.join(', ')}`);
  } else out(markdown);
  return check && report.status !== 'ok' ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = runBudgetReport(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Budget report failed.'); process.exitCode = 1; }
}
