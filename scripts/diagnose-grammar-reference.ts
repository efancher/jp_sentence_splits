/**
 * Read-only: how much of the learner's grammar data resolves to a curated reference list (OpenJLPT, CC BY-SA 4.0).
 * Fetches the reference JSON at run time (never vendored) and matches the learner's `grammar_patterns` by name/alias,
 * then reports how many not-yet-introduced sentences carry at least one curated-pattern link and the distribution of
 * unknown curated patterns per sentence. Nothing is written.
 *
 * Usage: npm run diagnose:grammar-reference [-- --dir <local OpenJLPT data/json/grammar dir>]
 * See docs/ROADMAP.md ("organic vocabulary/grammar growth"). Without --dir, files come from OpenJLPT's main branch.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildReferenceIndex, matchOwnPattern, type ReferencePattern } from '../src/lib/grammarReference';
import { unknownCountHistogram } from '../src/lib/unknownLemmas';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;
const LEVELS = ['n5', 'n4', 'n3', 'n2', 'n1'];
const BASE = 'https://raw.githubusercontent.com/evanclan/OpenJLPT/main/data/json/grammar';

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function loadReference(): Promise<ReferencePattern[]> {
  const dir = flag('dir');
  const out: ReferencePattern[] = [];
  for (const level of LEVELS) {
    const text = dir
      ? readFileSync(join(dir, `${level}.json`), 'utf8')
      : await fetch(`${BASE}/${level}.json`).then((r) => {
          if (!r.ok) throw new Error(`Failed to fetch ${level}: ${r.status}`);
          return r.text();
        });
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed : (Object.values(parsed).find(Array.isArray) as ReferencePattern[]);
    out.push(...items);
  }
  return out;
}

function entryKey(entry: ReferencePattern): string {
  return `${entry.pattern} [${entry.level ?? '?'}]`;
}

function formatHistogram(buckets: number[]): string {
  const last = buckets.length - 1;
  return buckets.map((n, i) => `${i === last ? `${last}+` : i}:${n}`).join('  ');
}

async function main(): Promise<void> {
  const reference = await loadReference();
  const index = buildReferenceIndex(reference);
  const client = await createScriptSupabaseClient();
  const { id: ownerId } = await requireAuthedUser(client);
  const [patterns, links, bookSentences, events, studyItems] = await Promise.all([
    fetchAll<Row>(client, 'grammar_patterns', 'id,canonical_name,aliases,family', ownerId, (r) => r),
    fetchAll<Row>(client, 'sentence_grammar', 'id,sentence_id,grammar_pattern_id', ownerId, (r) => r),
    fetchAll<Row>(client, 'book_sentences', 'id,sentence_id,status', ownerId, (r) => r),
    fetchAll<Row>(client, 'sentence_learning_events', 'id,sentence_id,action', ownerId, (r) => r),
    fetchAll<Row>(client, 'study_items', 'id,subject_id,subject_type', ownerId, (r) => r),
  ]);

  const matches = new Map<string, ReturnType<typeof matchOwnPattern>>();
  for (const p of patterns) {
    matches.set(
      p.id,
      matchOwnPattern({ id: p.id, canonicalName: p.canonical_name, aliases: p.aliases ?? [] }, index),
    );
  }
  const matched = patterns.filter((p) => matches.get(p.id));
  const ambiguous = matched.filter((p) => matches.get(p.id)!.ambiguous);
  console.log(`reference patterns ${reference.length}; learner patterns ${patterns.length}`);
  console.log(`matched ${matched.length} (ambiguous ${ambiguous.length}); unmatched ${patterns.length - matched.length}`);
  const byLevel = new Map<string, number>();
  for (const p of matched) {
    const level = matches.get(p.id)!.entries[0]!.level ?? '?';
    byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
  }
  console.log('matched by level:', Object.fromEntries([...byLevel].sort()));
  console.log('unmatched sample:', patterns.filter((p) => !matches.get(p.id)).slice(0, 12).map((p) => p.canonical_name));
  console.log('ambiguous sample:', ambiguous.slice(0, 6).map((p) => p.canonical_name));

  const introduced = new Set<string>();
  for (const e of events) if (e.action === 'walkthrough_completed') introduced.add(e.sentence_id);
  for (const b of bookSentences) if (b.status !== 'unstarted') introduced.add(b.sentence_id);
  for (const i of studyItems) if (i.subject_type === 'sentence') introduced.add(i.subject_id);
  const candidates = [...new Set(bookSentences.map((b) => b.sentence_id as string))].filter((id) => !introduced.has(id));

  const curatedBySentence = new Map<string, Set<string>>();
  let allLinks = 0;
  let curatedLinks = 0;
  for (const link of links) {
    allLinks += 1;
    const match = matches.get(link.grammar_pattern_id);
    if (!match) continue;
    curatedLinks += 1;
    // Key by curated entry, not the learner's pattern id: duplicate learner patterns for one concept count once.
    const set = curatedBySentence.get(link.sentence_id) ?? new Set<string>();
    set.add(entryKey(match.entries[0]!));
    curatedBySentence.set(link.sentence_id, set);
  }
  const known = new Set<string>();
  for (const id of introduced) for (const g of curatedBySentence.get(id) ?? []) known.add(g);

  console.log(`\nlinks ${allLinks}; resolving to a curated pattern ${curatedLinks}`);
  console.log(`introduced sentences with a curated link ${[...introduced].filter((id) => curatedBySentence.has(id)).length}/${introduced.size}; known curated entries ${known.size}`);
  const withCurated = candidates.filter((id) => curatedBySentence.has(id));
  console.log(`candidates ${candidates.length}; with at least one curated-pattern link ${withCurated.length}`);
  console.log('unknown curated entries per linked candidate:');
  console.log(formatHistogram(unknownCountHistogram(withCurated.map((id) => [...curatedBySentence.get(id)!].filter((g) => !known.has(g)).length), 5)));

  const freq = new Map<string, number>();
  for (const id of withCurated) for (const g of curatedBySentence.get(id)!) if (!known.has(g)) freq.set(g, (freq.get(g) ?? 0) + 1);
  console.log('top unknown curated entries by candidate-sentence count:');
  for (const [g, n] of [...freq].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${n}\t${g}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
