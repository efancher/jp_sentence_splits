/**
 * Read-only audit of curated grammar entries the text detector skips because several entries share the same fixed
 * text (different senses of one form, e.g. ながら（while）/（even though）). For each shared form, lists the entries
 * and how many of the learner's sentences contain it, with a few contexts, to judge which senses a guard could
 * separate. Nothing is written.
 *
 * Usage: npm run diagnose:grammar-ambiguous [-- --samples 4] [--min 5]
 */
import openJlptGrammar from '../src/data/openJlptGrammar.json';
import { detectableSegments } from '../src/lib/grammarReference';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main(): Promise<void> {
  const samples = Number(flag('samples') ?? 4);
  const min = Number(flag('min') ?? 5);
  const groups = new Map<string, Array<{ id: string; pattern: string; level?: string; formation?: string }>>();
  for (const entry of openJlptGrammar.patterns) {
    if (!entry.id) continue;
    for (const segments of detectableSegments(entry as never)) {
      const key = segments.join('〜');
      const list = groups.get(key) ?? [];
      if (!list.some((other) => other.id === entry.id)) list.push(entry as never);
      groups.set(key, list);
    }
  }
  const shared = [...groups.entries()].filter(([, list]) => list.length > 1);

  const client = await createScriptSupabaseClient();
  const { id: ownerId } = await requireAuthedUser(client);
  const sentences = await fetchAll<Row>(client, 'sentences', 'id,japanese', ownerId, (r) => r);

  const rows = shared
    .map(([key, list]) => {
      const first = key.split('〜')[0]!;
      const hits = sentences.filter((s) => (s.japanese ?? '').includes(first) && key.split('〜').every((seg) => (s.japanese ?? '').includes(seg)));
      return { key, list, hits };
    })
    .filter((row) => row.hits.length >= min)
    .sort((a, b) => b.hits.length - a.hits.length);

  console.log(`${sentences.length} sentences; ${shared.length} shared forms; ${rows.length} with >= ${min} sentences`);
  for (const { key, list, hits } of rows) {
    console.log(`\n${key}  sentences=${hits.length}`);
    for (const entry of list) console.log(`  - ${entry.pattern} [${entry.level ?? '?'}] id=${entry.id} :: ${entry.formation ?? ''}`);
    for (const hit of hits.slice(0, samples)) console.log(`    ${hit.japanese}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
