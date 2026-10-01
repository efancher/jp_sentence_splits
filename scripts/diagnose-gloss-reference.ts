/**
 * Read-only feasibility check for progressive glossing: what share of real
 * sentences yield settled (auto-gradable) predicate / particle / attachment
 * decisions from the saved chunk analysis.
 *
 * Usage: npm run diagnose:gloss-reference
 */
import { buildDecisions } from '../src/lib/glossSkill';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function main() {
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);
  const analyses = await fetchAll(supabase, 'analyses', 'sentence_id, chunks', user.id, (r) => ({
    sentenceId: String(r.sentence_id),
    chunks: (r.chunks as { id: string; japanese: string; role: string }[] | null) ?? [],
  }));
  let withChunks = 0;
  let anySettled = 0;
  const bySkill = { predicate: 0, particle: 0, attachment: 0 };
  const byRule = new Map<string, number>();
  for (const analysis of analyses) {
    if (analysis.chunks.length === 0) continue;
    withChunks += 1;
    const settled = buildDecisions(analysis.chunks).filter((spec) => spec.confidence === 'settled');
    if (settled.length > 0) anySettled += 1;
    for (const spec of settled) {
      bySkill[spec.skill] += 1;
      byRule.set(spec.ruleKey, (byRule.get(spec.ruleKey) ?? 0) + 1);
    }
  }
  const pct = (n: number) => (withChunks ? `${((n / withChunks) * 100).toFixed(1)}%` : 'n/a');
  console.log(`analysed sentences with chunks: ${withChunks}`);
  console.log(`sentences with >=1 settled decision: ${anySettled} (${pct(anySettled)})`);
  console.log('settled decisions by skill:', bySkill);
  console.log('by rule:', Object.fromEntries([...byRule].sort((a, b) => b[1] - a[1])));
}

void main();
