import { execFileSync } from 'node:child_process';
import { remoteToSentenceLearningEvent, sentenceLearningEventToRemote } from '../../src/sync/mappers';
const psql = (sql: string) => execFileSync('docker', ['exec', '-i', 'mig-rehearsal', 'psql', '-At', '-U', 'supabase_admin', '-h', '127.0.0.1', '-d', 'postgres'], { input: sql }).toString();
const actions = ['walkthrough_opened','walkthrough_completed','target_practice','compare_uses_viewed','content_report','gist_check','expression_attempt','report_resolved','transfer_attempt','transfer_recheck'] as const;
let bad = 0;
for (const action of actions) {
  const ev: any = { id: `rt_${action}`, timestamp: '2026-09-30T10:00:00.000Z', visitId: 'v', action, bookId: 'b', chapterId: 'c', sentenceId: 's',
    target: { kind: 'grammar', key: 'k', label: 'l' }, support: 'target_masked', outcome: 'got_it', assessmentSource: 'self', report: 'poor_question',
    learnerAnswer: 'こんにちは', modality: 'spoken', scaffold: 'words_and_frame', unitsExpressed: 2, unitsTotal: 3, helpLevel: 'minimal', resolution: 'dismissed',
    exposedSentenceId: 's2', quietMode: false, inventoryRevision: 'r' };
  const remote = sentenceLearningEventToRemote(ev, '00000000-0000-0000-0000-00000000000a', 1);
  const json = JSON.stringify(remote).replace(/'/g, "''");
  psql(`insert into sentence_learning_events select * from jsonb_populate_record(null::sentence_learning_events, '${json}'::jsonb);`);
  const row = JSON.parse(psql(`select row_to_json(t) from sentence_learning_events t where id='rt_${action}';`));
  const back = remoteToSentenceLearningEvent(row);
  const norm = (o: any) => JSON.stringify({ ...o, ...(o.timestamp ? { timestamp: new Date(o.timestamp).toISOString() } : {}) }, Object.keys(o).sort());
  for (const k of Object.keys(ev)) if (norm({[k]: (back as any)[k]}) !== norm({[k]: ev[k]})) console.log('DIFF', action, k, (back as any)[k], ev[k]);
  const same = norm(back) === norm(ev); // JSON.stringify(back, Object.keys(back).sort()) === JSON.stringify(ev, Object.keys(ev).sort());
  if (!same) { bad++; console.log('MISMATCH', action, back); }
}
console.log(bad === 0 ? `round-trip OK for ${actions.length} actions through real Postgres` : `${bad} mismatches`);
