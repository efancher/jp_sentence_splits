/** Dry run by default. --apply requires --backup <new file>; compare-and-swap protects concurrent edits. */
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { AnalysisChunk } from '../src/domain/types';
import { PILOT_CHUNK_REPAIRS, repairPilotChunks } from '../src/lib/pilotChunkRepairs';
import { requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false }, backup: { type: 'string' } } });
if (values.apply && !values.backup) throw new Error('--apply requires --backup <new file>');
const client = await createScriptSupabaseClient();
const user = await requireAuthedUser(client);
const plans = [];
for (const repair of PILOT_CHUNK_REPAIRS) {
  const { data: sentence, error: sourceError } = await client.from('sentences').select('japanese')
    .eq('id', repair.sentenceId).eq('owner_id', user.id).is('deleted_at', null).single();
  if (sourceError) throw sourceError;
  const { data: original, error } = await client.from('analyses').select('*')
    .eq('sentence_id', repair.sentenceId).eq('owner_id', user.id).is('deleted_at', null).single();
  if (error) throw error;
  const chunks = repairPilotChunks(repair.sentenceId, sentence.japanese, original.chunks as AnalysisChunk[]);
  if (!chunks) { console.log(`${repair.sentenceId}: no matching repair (already repaired, changed, or annotated).`); continue; }
  if (!Number.isSafeInteger(original.version)) throw new Error('Missing analysis version; cannot safely update.');
  plans.push({ original, chunks });
  console.log(`${repair.sentenceId}: ${repair.before.join(' / ')} → ${repair.after.map((c) => c.japanese).join(' / ')}`);
}
if (values.apply && plans.length) {
  await writeFile(values.backup!, JSON.stringify({ savedAt: new Date().toISOString(), analyses: plans.map((p) => p.original) }, null, 2), { flag: 'wx', mode: 0o600 });
  for (const { original, chunks } of plans) {
    const { data, error } = await client.from('analyses').update({ chunks })
      .eq('sentence_id', original.sentence_id).eq('owner_id', user.id).eq('version', original.version).is('deleted_at', null)
      .select('sentence_id,version');
    if (error) throw error;
    if (data?.length !== 1) throw new Error(`Concurrent edit: ${original.sentence_id}; stopped without overwriting it.`);
    console.log(`Updated ${original.sentence_id} to version ${data[0]!.version}.`);
  }
}
console.log(`${plans.length} repair(s) ${values.apply ? 'applied' : 'proposed; dry run only'}.`);
