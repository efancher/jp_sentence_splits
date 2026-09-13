/**
 * Third-pass backfill of `vocabulary_items.pitch_accent_positions`, for
 * items still blank after both `backfill:pitch-accent` (Kanjium) and
 * `backfill:pitch-accent-unidic` (UniDic via the mining service) — run
 * this last, against whatever's left.
 *
 * Sources Wiktionary's own Pronunciation section, which cites NHK/DJR
 * accent dictionaries directly (e.g. "(Nakadaka – [2])"), by fetching each
 * item's live page (`https://en.wiktionary.org/wiki/<expression>`) — the
 * same real-world data this session used to verify pitchAccentShift.ts's
 * conjugation-accent formulas (docs/STATUS.md 2026-09-12), just per-word
 * lookup instead of a one-off spot-check. First script in this codebase to
 * do per-page external HTML fetches (as opposed to one bulk dictionary
 * download or batched internal-API calls) — sends a descriptive
 * User-Agent and a politeness delay between requests, since this hits a
 * shared community resource, not our own infrastructure.
 *
 * Skips (never guesses) when: the page doesn't exist or redirects to a
 * different headword, no Japanese-accent-tagged Pronunciation entry is
 * found, or more than one distinct accent position is cited (ambiguous —
 * same "don't guess, log for a hand check" stance as the Kanjium pass's
 * multi-position case). Dry-run by default; --apply required to write.
 *
 * Usage: npm run backfill:pitch-accent-wiktionary -- [--apply]
 */
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const USER_AGENT = 'jp-sentence-splits-pitch-accent-backfill/1.0 (personal-use Japanese learning app)';
const REQUEST_DELAY_MS = 1500;

interface VocabularyItemRow {
  id: string;
  expression: string;
  reading: string;
}

async function fetchBlankItems(
  supabase: Awaited<ReturnType<typeof createScriptSupabaseClient>>,
  ownerId: string,
): Promise<VocabularyItemRow[]> {
  const all = await fetchAll(
    supabase,
    'vocabulary_items',
    'id, expression, reading, pitch_accent_positions',
    ownerId,
    (row) => ({
      id: String(row.id),
      expression: String(row.expression),
      reading: String(row.reading ?? ''),
      pitchAccentPositions: (row.pitch_accent_positions as number[] | null) ?? [],
    }),
  );
  return all
    .filter((row) => row.reading.trim() && row.pitchAccentPositions.length === 0)
    .map(({ id, expression, reading }) => ({ id, expression, reading }));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// "はしる [hàshíꜜrù] (Nakadaka – [2])" / "かう [kàú] (Heiban – [0])" — the
// exact text Wiktionary's {{ja-pron}} template renders in a Pronunciation
// section (matched against the *tag-stripped* page, not raw HTML, so it
// survives the accent-underline `<span>` overlay around the kana). Group 1
// is the kana reading that accent entry is *for* — load-bearing: a single
// spelling can host several distinct Japanese words (開ける is あける,
// ひらける, and はだける, each with its own accent and none matching the
// others), so matching on kana lets a multi-reading page still resolve
// cleanly instead of always looking "ambiguous". Verified against real
// fetched pages for 走る/買う/食べる/開ける/高い/甘い/存じる and others this
// session, including the ꜜ downstep mark and the acute-n moraic marker
// (ń, e.g. ぞんじる's [zòńjíꜜrù]) inside the romaji brackets — two earlier
// drafts of this pattern each omitted one of those from the character
// class and silently failed to match (docs/STATUS.md 2026-09-12/13). A
// missing character here is a false negative (item stays blank, safe) not
// a false positive, but still worth widening deliberately rather than
// finding gaps one skipped word at a time.
const ACCENT_PATTERN =
  /([ぁ-んー]+)\s*\[[a-zàáâèéêìíîòóôùúûǹńꜜ ]+\]\s*\((?:Heiban|Nakadaka|Atamadaka|Odaka)\s*[–-]\s*\[(\d+)\]\)/g;

export type LookupResult =
  | { kind: 'found'; position: number }
  | { kind: 'not-found' }
  | { kind: 'no-page' }
  | { kind: 'ambiguous'; positions: number[] };

async function lookupWiktionaryPitch(expression: string, reading: string): Promise<LookupResult> {
  const url = `https://en.wiktionary.org/wiki/${encodeURIComponent(expression)}`;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (response.status === 404) return { kind: 'no-page' };
  if (!response.ok) throw new Error(`Wiktionary fetch failed for ${expression}: HTTP ${response.status}`);
  const html = await response.text();
  return parseWiktionaryAccentHtml(html, reading);
}

/** Pure parsing half of lookupWiktionaryPitch, split out for direct unit testing (see tests/backfillPitchAccentWiktionary.test.ts) — no network involved. */
export function parseWiktionaryAccentHtml(html: string, reading: string): LookupResult {
  // Reading a redirect target as if it were the real page would silently
  // teach the wrong word's accent — bail rather than guess.
  if (/wgIsRedirect["\s:]*true/.test(html)) return { kind: 'no-page' };

  const text = html.replace(/<[^>]+>/g, '');
  const pairs = [...text.matchAll(ACCENT_PATTERN)].map(
    (match) => [match[1]!, Number(match[2])] as const,
  );
  const forThisReading = pairs.filter(([kana]) => kana === reading);
  if (forThisReading.length === 0) return { kind: 'not-found' };
  const distinct = [...new Set(forThisReading.map(([, position]) => position))];
  if (distinct.length > 1) return { kind: 'ambiguous', positions: distinct };
  return { kind: 'found', position: distinct[0]! };
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log('Fetching vocabulary items still missing pitch-accent data...');
  const items = await fetchBlankItems(supabase, user.id);
  console.log(`Found ${items.length} item(s) with no pitch-accent data.`);
  if (!items.length) return;

  let matched = 0;
  let noPage = 0;
  let notFound = 0;
  const ambiguous: string[] = [];

  for (const [index, item] of items.entries()) {
    if (index > 0) await sleep(REQUEST_DELAY_MS);
    const result = await lookupWiktionaryPitch(item.expression, item.reading);
    if (result.kind === 'no-page') {
      noPage += 1;
      continue;
    }
    if (result.kind === 'not-found') {
      notFound += 1;
      continue;
    }
    if (result.kind === 'ambiguous') {
      ambiguous.push(`${item.expression} [${item.reading}] — Wiktionary: ${result.positions.join(', ')}`);
      continue;
    }
    matched += 1;
    console.log(`  ${item.expression} [${item.reading}] — position: ${result.position}`);
    if (apply) {
      const { error } = await supabase
        .from('vocabulary_items')
        .update({ pitch_accent_positions: [result.position] })
        .eq('id', item.id);
      if (error) {
        throw new Error(`Failed to update vocabulary_item ${item.id}: ${error.message}`);
      }
    }
  }

  console.log(
    `\nDone. ${matched} item(s) ${apply ? 'updated' : 'would be updated'}, ${noPage} had no Wiktionary page, ${notFound} had no accent-tagged pronunciation for that reading.`,
  );
  if (ambiguous.length) {
    console.log(`\n${ambiguous.length} item(s) skipped — more than one accent cited. Set by hand:`);
    for (const line of ambiguous) console.log(`  ${line}`);
  }
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
