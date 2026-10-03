/**
 * Lists open chunk-boundary issue reports (flagged by the assistant during
 * particle-check import) from Supabase, for a Claude session to triage —
 * typically by extending src/lib/chunking.ts. Read-only.
 *
 * Usage: npm run issues:list-chunks
 */
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function main() {
  const supabase = await createScriptSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Signed in but no user on session — unexpected.');

  const { data: reports, error } = await supabase
    .from('chunk_issue_reports')
    .select('id, sentence_id, chunks, note, created_at')
    .eq('owner_id', user.id)
    .eq('status', 'open')
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to fetch reports: ${error.message}`);
  if (!reports?.length) {
    console.log('No open chunk issue reports.');
    return;
  }

  console.log(`${reports.length} open chunk issue report(s):\n`);
  for (const report of reports) {
    console.log(`- [${report.id}] sentence ${report.sentence_id} reported ${report.created_at}`);
    console.log(`  chunks: ${(report.chunks as string[]).join(' | ')}`);
    console.log(`  issue:  ${report.note}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
