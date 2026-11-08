/**
 * Read-only: did the chunk chain help? Per chain visit that opened with the optional cold whole-sentence
 * try, compares that cold self-rating with the chain's last rung rating (docs/ROADMAP.md, "Phrase
 * shadowing"). Self-ratings only; the cold try is offered to a random ~25% of runs. Small samples are
 * anecdotes, not evidence: read the counts, not just the shares.
 *
 * Usage: npm run diagnose:chunk-chain-outcomes [-- --json]
 */
import { summariseChainOutcomes, type ChainEventRow } from './lib/chunkChainOutcomes';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function main() {
  const json = process.argv.includes('--json');
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const rows = await fetchAll<ChainEventRow & { action: string }>(
    supabase,
    'sentence_learning_events',
    'id,action,visit_id,sentence_id,target_key,outcome,timestamp',
    user.id,
    (r) => ({
      action: String(r.action),
      visitId: String(r.visit_id),
      sentenceId: String(r.sentence_id),
      targetKey: r.target_key == null ? null : String(r.target_key),
      outcome: r.outcome == null ? null : String(r.outcome),
      timestamp: String(r.timestamp),
    }),
  );
  const summary = summariseChainOutcomes(rows.filter((row) => row.action === 'phrase_shadow'));
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`Chain visits: ${summary.chainVisits} (${summary.coldVisits} opened with a cold try, ${summary.comparable} comparable)`);
  if (summary.comparable === 0) {
    console.log('No cold-vs-chain pairs yet.');
    return;
  }
  console.log(`Chain end vs cold: better ${summary.better}, same ${summary.same}, worse ${summary.worse}`);
  console.log(`Got it on cold: ${summary.coldGotIt}/${summary.comparable}; Got it at the chain's last rating: ${summary.topGotIt}/${summary.comparable}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
