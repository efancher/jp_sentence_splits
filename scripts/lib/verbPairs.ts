/**
 * Ports `anki/wk_decks.py`'s transitive/intransitive verb-pairing algorithm
 * (`PAIR_RULES`/`CURATED_READING_PAIRS`, `is_probably_verb`,
 * `candidate_pair_from_reading`, `find_verb_pairs` — lines 599–619 and
 * 2596–2610/5731 of that file) — a suffix-swap table plus a small set of
 * curated exceptions, applied to vocabulary sharing a derived reading pair
 * (e.g. 表れる/表す). Pure, no Supabase/IO — see
 * scripts/backfill-verb-pair-confusions.ts for the script that writes
 * results, docs/STATUS.md for why this is a separate phase from the
 * schema/UI that consumes it.
 */

/** [intransitive-ending, transitive-ending] suffix-swap rules. */
const PAIR_RULES: [string, string][] = [
  ['がる', 'げる'],
  ['まる', 'める'],
  ['かる', 'ける'],
  ['わる', 'える'],
  ['つ', 'てる'],
  ['れる', 'す'],
  ['える', 'やす'],
  ['く', 'ける'],
];

/** Reading pairs that don't fit the suffix-swap rules, hand-curated in the source. */
const CURATED_READING_PAIRS: Record<string, string> = {
  あく: 'あける',
  しまる: 'しめる',
  つく: 'つける',
  でる: 'だす',
  みえる: 'みる',
  みせる: 'みる',
  きこえる: 'きく',
  きかせる: 'きく',
};

const VERB_MEANING_MARKERS = [
  'to ',
  'to be ',
  'to become ',
  'to make ',
  'to raise ',
  'to lower ',
  'to open ',
  'to close ',
  'to see ',
  'to hear ',
];

export function isProbablyVerb(expression: string, meaning: string): boolean {
  if (expression.endsWith('る')) return true;
  const lower = meaning.toLowerCase();
  return VERB_MEANING_MARKERS.some((marker) => lower.includes(marker));
}

/** Given a reading, returns [intransitive, transitive] candidate readings, or null. */
export function candidatePairFromReading(reading: string): [string, string] | null {
  const curated = CURATED_READING_PAIRS[reading];
  if (curated) return [reading, curated];
  for (const [intransitiveEnd, transitiveEnd] of PAIR_RULES) {
    if (reading.endsWith(intransitiveEnd)) {
      return [reading, reading.slice(0, -intransitiveEnd.length) + transitiveEnd];
    }
    if (reading.endsWith(transitiveEnd)) {
      return [reading.slice(0, -transitiveEnd.length) + intransitiveEnd, reading];
    }
  }
  return null;
}

export interface VerbPairCandidate {
  id: string;
  expression: string;
  reading: string;
  meaning: string;
}

/**
 * Groups probable verbs by reading, derives each reading's candidate
 * partner reading, and pairs them when both sides exist in the input —
 * one pair per distinct reading-pair, not one per vocabulary-item
 * permutation. When multiple items share a reading (homophones), the
 * lowest-id item is picked deterministically, matching this codebase's
 * existing tie-breaking convention elsewhere (e.g. `getVocabularyTargetCandidates`'s
 * "first qualifying link wins").
 */
export function findVerbPairs(
  items: VerbPairCandidate[],
): [VerbPairCandidate, VerbPairCandidate][] {
  const byReading = new Map<string, VerbPairCandidate[]>();
  for (const item of items) {
    if (!item.reading || !isProbablyVerb(item.expression, item.meaning)) continue;
    const list = byReading.get(item.reading);
    if (list) list.push(item);
    else byReading.set(item.reading, [item]);
  }

  const pairs: [VerbPairCandidate, VerbPairCandidate][] = [];
  const seenReadingPairs = new Set<string>();
  for (const reading of byReading.keys()) {
    const candidate = candidatePairFromReading(reading);
    if (!candidate) continue;
    const [intransitiveReading, transitiveReading] = candidate;
    const key = `${intransitiveReading}:${transitiveReading}`;
    if (seenReadingPairs.has(key)) continue;
    const intransitiveItems = byReading.get(intransitiveReading);
    const transitiveItems = byReading.get(transitiveReading);
    if (!intransitiveItems || !transitiveItems) continue;
    seenReadingPairs.add(key);
    const intransitiveItem = bestById(intransitiveItems);
    const transitiveItem = bestById(transitiveItems);
    if (intransitiveItem.id !== transitiveItem.id) {
      pairs.push([intransitiveItem, transitiveItem]);
    }
  }
  return pairs;
}

function bestById(items: VerbPairCandidate[]): VerbPairCandidate {
  return [...items].sort((a, b) => a.id.localeCompare(b.id))[0]!;
}
