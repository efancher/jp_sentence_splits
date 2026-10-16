/** Read-only export of chunked sentences for a manually reviewed clause pilot.
 * Run with the usual script credentials and --output <path>; the file contains personal study text.
 * No generated reference is written back to the learner database.
 */
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const { values } = parseArgs({ options: { output: { type: 'string' } } });
if (!values.output) throw new Error('Usage: tsx scripts/sample-gloss-pilot.ts --output <path>');
const client = await createScriptSupabaseClient();
const user = await requireAuthedUser(client);
const analyses = await fetchAll(client, 'analyses', 'sentence_id,chunks', user.id,
  (row) => ({ id: String(row.sentence_id), chunks: row.chunks as { japanese: string; role: string }[] }), 'sentence_id');
const chunked = analyses.filter((row) => row.chunks?.length);
const sentences = new Map<string, { japanese: string; translation: string }>();
for (let start = 0; start < chunked.length; start += 100) {
  const { data, error } = await client.from('sentences').select('id,japanese,translation')
    .eq('owner_id', user.id).is('deleted_at', null).in('id', chunked.slice(start, start + 100).map((row) => row.id));
  if (error) throw error;
  for (const row of data ?? []) sentences.set(row.id, row);
}
const sample = chunked.flatMap((row) => {
  const sentence = sentences.get(row.id);
  return sentence ? [{ ...row, japanese: sentence.japanese, translation: sentence.translation }] : [];
});
await writeFile(values.output, JSON.stringify(sample, null, 2) + '\n');
console.log(`Exported ${sample.length} chunked sentences to ${values.output}; no database changes.`);
