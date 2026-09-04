/**
 * Lists open sync-issue reports (ConflictPanel/Account & sync settings'
 * "Report sync issue" button) from Supabase, including each report's
 * diagnostics snapshot — meant for a future Claude session to read and
 * triage in bulk. Read-only.
 *
 * Usage: npm run issues:list-sync
 */
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function main() {
  const supabase = await createScriptSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Signed in but no user on session — unexpected.');

  const { data: reports, error } = await supabase
    .from('sync_issue_reports')
    .select('id, note, diagnostics_snapshot, conflict_entity, conflict_record_id, created_at')
    .eq('owner_id', user.id)
    .eq('status', 'open')
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to fetch reports: ${error.message}`);
  if (!reports?.length) {
    console.log('No open sync issue reports.');
    return;
  }

  console.log(`${reports.length} open sync issue report(s):\n`);
  for (const report of reports) {
    const scope = report.conflict_entity
      ? `${report.conflict_entity} · ${report.conflict_record_id}`
      : 'general';
    console.log(`- [${report.id}] (${scope}) reported ${report.created_at}`);
    console.log(`  ${report.note}`);
    console.log(`  diagnostics: ${report.diagnostics_snapshot}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
