/**
 * Lists open card-issue reports (ReviewPage's "Report issue" button) from
 * Supabase, with sentence context — meant for a future Claude session to
 * read and triage in bulk. Read-only.
 *
 * Usage: npm run issues:list
 */
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function main() {
  const supabase = await createScriptSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Signed in but no user on session — unexpected.');

  const { data: reports, error } = await supabase
    .from('card_issue_reports')
    .select('id, study_item_id, sentence_id, activity_type, note, created_at')
    .eq('owner_id', user.id)
    .eq('status', 'open')
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to fetch reports: ${error.message}`);
  if (!reports?.length) {
    console.log('No open issue reports.');
    return;
  }

  const sentenceIds = [
    ...new Set(
      reports
        .map((report) => report.sentence_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const sentenceById = new Map<string, string>();
  if (sentenceIds.length) {
    const { data: sentences, error: sentenceError } = await supabase
      .from('sentences')
      .select('id, japanese')
      .in('id', sentenceIds);
    if (sentenceError) {
      throw new Error(`Failed to fetch sentences: ${sentenceError.message}`);
    }
    for (const row of sentences ?? []) {
      sentenceById.set(row.id as string, row.japanese as string);
    }
  }

  console.log(`${reports.length} open issue report(s):\n`);
  for (const report of reports) {
    const sentence = report.sentence_id
      ? (sentenceById.get(report.sentence_id) ?? '(sentence not found)')
      : '(no sentence recorded)';
    console.log(`- [${report.id}] (${report.activity_type}) ${sentence}`);
    console.log(`  ${report.note}`);
    console.log(`  reported ${report.created_at} · study_item ${report.study_item_id}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
