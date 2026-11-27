/**
 * Read-only: words the learner keeps missing (reader reading taps / Word checks) next to how much sentence supply
 * the corpus has for them. Flags words that look like 習慣/趣味/略語 did: failed taps, few corpus sentences, and
 * most of those sentences already introduced (or none left to offer), so i+1 has little new context to bring back.
 *
 * Matching is by sentence text (the tapped word's label, minus a trailing kana for verbs/adjectives), so it is an
 * approximation for inflected words. Nothing is written. A reset is `npm run unintroduce:sentences`.
 *
 * Usage: npm run diagnose:struggling-words [-- --min-failures 1] [--limit 40]
 */
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

function numberFlag(argv: string[], flag: string, fallback: number): number {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? Number(argv[index + 1]) : NaN;
  return Number.isFinite(value) ? value : fallback;
}

/** Text to search for: the label, minus a trailing hiragana (inflection) when something longer remains. */
function searchStem(label: string): string {
  return label.length >= 2 && /[ぁ-ゖ]$/.test(label) ? label.slice(0, -1) : label;
}

async function main() {
  const argv = process.argv.slice(2);
  const minFailures = numberFlag(argv, '--min-failures', 1);
  const limit = numberFlag(argv, '--limit', 40);
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const [events, sentences, items] = await Promise.all([
    fetchAll(supabase, 'sentence_learning_events', 'id, sentence_id, action, timestamp, target_key, target_label, outcome', user.id, (r) => ({
      sentenceId: String(r.sentence_id),
      action: String(r.action),
      timestamp: String(r.timestamp),
      key: r.target_key ? String(r.target_key) : '',
      label: r.target_label ? String(r.target_label) : '',
      outcome: r.outcome ? String(r.outcome) : '',
    })),
    fetchAll(supabase, 'sentences', 'id, japanese', user.id, (r) => ({ id: String(r.id), japanese: String(r.japanese) })),
    fetchAll(supabase, 'study_items', 'id, subject_type, subject_id', user.id, (r) => ({
      subjectType: String(r.subject_type),
      subjectId: String(r.subject_id),
    })),
  ]);

  // Introduced = completed walkthrough not cancelled by a later reset, or any sentence card.
  const resetAt = new Map<string, string>();
  for (const e of events) {
    if (e.action === 'walkthrough_reset' && e.timestamp > (resetAt.get(e.sentenceId) ?? '')) resetAt.set(e.sentenceId, e.timestamp);
  }
  const introduced = new Set<string>();
  for (const e of events) {
    if (e.action === 'walkthrough_completed' && e.timestamp > (resetAt.get(e.sentenceId) ?? '')) introduced.add(e.sentenceId);
  }
  for (const item of items) if (item.subjectType === 'sentence') introduced.add(item.subjectId);

  type Tally = { label: string; failures: number; successes: number; latestAt: string; latestFailed: boolean };
  const byWord = new Map<string, Tally>();
  for (const e of events) {
    if (e.action !== 'target_practice' || !e.outcome) continue;
    const id = e.key.startsWith('vocab-read:') ? e.key.slice(11) : e.key.startsWith('vocab:') ? e.key.slice(6) : undefined;
    if (!id) continue;
    const tally = byWord.get(id) ?? { label: e.label, failures: 0, successes: 0, latestAt: '', latestFailed: false };
    if (e.outcome === 'needed_help') tally.failures += 1;
    else if (e.outcome === 'got_it') tally.successes += 1;
    if (e.timestamp >= tally.latestAt) {
      tally.latestAt = e.timestamp;
      tally.latestFailed = e.outcome === 'needed_help';
    }
    if (e.label) tally.label = e.label;
    byWord.set(id, tally);
  }

  const rows = [...byWord.values()]
    .filter((t) => t.failures >= minFailures && t.latestFailed && t.label)
    .map((t) => {
      const stem = searchStem(t.label);
      const matching = sentences.filter((s) => s.japanese.includes(stem));
      const introducedCount = matching.filter((s) => introduced.has(s.id)).length;
      return { ...t, total: matching.length, introducedCount, untouched: matching.length - introducedCount };
    })
    .sort((a, b) => a.untouched - b.untouched || b.failures - a.failures);

  console.log(`${byWord.size} tapped word(s); ${rows.length} with ≥${minFailures} failed tap(s) and the latest a failure.`);
  console.log('word\tfailed\tgot_it\tcorpus\tintroduced\tuntouched');
  for (const r of rows.slice(0, limit)) {
    console.log(`${r.label}\t${r.failures}\t${r.successes}\t${r.total}\t${r.introducedCount}\t${r.untouched}`);
  }
  console.log('\nFew "untouched" with failures = nothing new left to bring the word back; many = i+1 just has not reached them.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
