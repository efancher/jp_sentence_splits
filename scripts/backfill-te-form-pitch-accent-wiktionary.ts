/**
 * Backfills `vocabulary_items.te_form_accent_position` — the te-form's own
 * pitch-accent downstep, which (unlike the citation form) can't be derived
 * from `pitch_accent_positions` by formula: an accented word's te-form can
 * retract to an earlier mora or stay put depending on the specific word
 * (`src/lib/pitchAccentShift.ts`'s doc comment — confirmed by real data:
 * 走って keeps 走る's citation position, 食べて retracts one mora earlier
 * than 食べる's). Also covers `plain_past`/`tara_form`, both derived from
 * this same value in `pitchAccentShift.ts`.
 *
 * Targets confirmed godan/ichidan verbs that already have citation-form
 * `pitch_accent_positions` but no `te_form_accent_position` yet — a
 * different, mostly-disjoint set from `backfill-pitch-accent-wiktionary.ts`
 * (which targets items with *no* accent data at all), so this is a
 * separate script/pass rather than an extension of that one.
 *
 * Sources Wiktionary's "Extended conjugation" table (the same page the
 * citation-form backfill already fetches), specifically the "Conjunctive"
 * (te-form) row. Unlike the citation form's Pronunciation-section entry,
 * this row has no explicit "(Nakadaka – [N])" annotation — the downstep is
 * only encoded structurally: the kana cell wraps the high-pitch span in
 * `<span style="border-top:...">`, and when there's an audible drop, a
 * nested empty `<span style="position:absolute;...border-right:...">`
 * marks exactly which mora the drop lands after (no nested marker at all
 * means heiban). Parsed directly from raw HTML (not the tag-stripped text
 * the citation pattern uses) so that nesting survives; `segmentIntoMorae`
 * (already in the app) does the actual mora counting once the boundary is
 * found. Verified against real fetched pages for 走る (no retraction),
 * 食べる (retracts one mora), 買う/開ける (heiban, flat), including a
 * multi-reading page (開ける hosts あける and ひらける — each correctly
 * resolves its own distinct te-form value, not the other's).
 *
 * Skips (never guesses) when: the citation-form anchor for that reading
 * isn't found or is itself ambiguous, no Conjunctive row is found within a
 * bounded window after it, or the row's kana cell doesn't match the
 * expected `<span border-top>` structure. Dry-run by default; --apply
 * required to write.
 *
 * Usage: npm run backfill:te-form-pitch-accent-wiktionary -- [--apply]
 */
import { segmentIntoMorae } from '../src/lib/mora';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const USER_AGENT = 'jp-sentence-splits-pitch-accent-backfill/1.0 (personal-use Japanese learning app)';
const REQUEST_DELAY_MS = 1500;
// Generous cap on how far past the citation anchor to search for the
// Conjunctive row when there's no next-reading citation to bound it —
// real "Extended conjugation" tables are well within this on every page checked.
const SEARCH_WINDOW_CHARS = 20000;

interface VocabularyItemRow {
  id: string;
  expression: string;
  reading: string;
}

async function fetchCandidateItems(
  supabase: Awaited<ReturnType<typeof createScriptSupabaseClient>>,
  ownerId: string,
): Promise<VocabularyItemRow[]> {
  const all = await fetchAll(
    supabase,
    'vocabulary_items',
    'id, expression, reading, pitch_accent_positions, te_form_accent_position, part_of_speech',
    ownerId,
    (row) => ({
      id: String(row.id),
      expression: String(row.expression),
      reading: String(row.reading ?? ''),
      pitchAccentPositions: (row.pitch_accent_positions as number[] | null) ?? [],
      teFormAccentPosition: (row.te_form_accent_position as number | null) ?? null,
      partOfSpeech: String(row.part_of_speech ?? ''),
    }),
  );
  return all
    .filter(
      (row) =>
        row.reading.trim() &&
        row.pitchAccentPositions.length > 0 &&
        row.teFormAccentPosition === null &&
        /\bv[15]/.test(row.partOfSpeech), // godan (v5*)/ichidan (v1) — the only classes pitchAccentShift.ts's te-form override currently consumes
    )
    .map(({ id, expression, reading }) => ({ id, expression, reading }));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Same citation-form pattern as backfill-pitch-accent-wiktionary.ts, kept
// in sync deliberately — used here only to anchor position in the page,
// not to re-derive the citation accent itself.
const ACCENT_PATTERN =
  /([ぁ-んー]+)\s*\[[a-zàáâèéêìíîòóôùúûǹńꜜ ]+\]\s*\((?:Heiban|Nakadaka|Atamadaka|Odaka)\s*[–-]\s*\[(\d+)\]\)/g;

export type TeFormLookupResult =
  | { kind: 'found'; position: number }
  | { kind: 'not-found' }
  | { kind: 'no-page' };

/** Strips HTML tags while keeping a map from stripped-text index back to the original raw-HTML index — needed because the citation anchor is found in tag-stripped text but the Conjunctive row must be parsed from raw HTML to see the span nesting. */
function stripTagsWithOffsets(html: string): { text: string; rawOffsetAt: (textIndex: number) => number } {
  let text = '';
  const offsets: number[] = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) break;
      i = close + 1;
      continue;
    }
    text += html[i];
    offsets.push(i);
    i += 1;
  }
  return { text, rawOffsetAt: (textIndex) => (textIndex < offsets.length ? offsets[textIndex]! : html.length) };
}

/**
 * Parses one Conjunctive row's kana `<td>` cell (raw HTML, spans intact)
 * into a downstep position. Exported for direct unit testing
 * (tests/backfillTeFormPitchAccentWiktionary.test.ts).
 */
export function parseKanaCellPosition(cellHtml: string): TeFormLookupResult {
  // The underline span may contain exactly one complete, empty inner
  // marker span; a naive non-greedy match would stop at the marker's own
  // closing tag instead of the outer span's, so explicitly allow one
  // complete inner span within the outer capture.
  const spanMatch = cellHtml.match(/<span[^>]*border-top[^>]*>((?:[^<]|<span[^>]*><\/span>)*)<\/span>/);
  if (!spanMatch) return { kind: 'not-found' };
  const prefix = cellHtml.slice(0, spanMatch.index).replace(/<[^>]+>/g, '');
  const underlineContent = spanMatch[1]!;
  const markerMatch = underlineContent.match(/^([^<]*)<span[^>]*position:absolute[^>]*><\/span>/);
  if (!markerMatch) return { kind: 'found', position: 0 }; // no drop within the word — heiban
  const beforeMarker = markerMatch[1]!;
  return { kind: 'found', position: segmentIntoMorae(prefix + beforeMarker).length };
}

/** Pure parsing half of the lookup, split out for direct unit testing — no network involved. */
export function extractTeFormAccentPosition(html: string, reading: string): TeFormLookupResult {
  if (/wgIsRedirect["\s:]*true/.test(html)) return { kind: 'no-page' };

  const { text, rawOffsetAt } = stripTagsWithOffsets(html);
  const matches = [...text.matchAll(ACCENT_PATTERN)];
  const forReading = matches.filter((match) => match[1] === reading);
  if (forReading.length === 0) return { kind: 'not-found' };
  // Ambiguous citation (more than one distinct position cited for this
  // reading) — the citation-form backfill would have skipped this word
  // too; don't anchor on an uncertain citation.
  if (new Set(forReading.map((match) => Number(match[2]))).size > 1) return { kind: 'not-found' };

  const anchor = forReading[0]!;
  const anchorEnd = anchor.index! + anchor[0].length;
  const rawAnchor = rawOffsetAt(anchorEnd);
  // Bound the search at the next *different* reading's citation, so a
  // multi-reading page (開ける: あける/ひらける/はだける) can't leak one
  // word's Conjunctive row into another's.
  const nextOtherReading = matches.find((match) => match.index! > anchor.index! && match[1] !== reading);
  const rawBound = nextOtherReading
    ? rawOffsetAt(nextOtherReading.index!)
    : Math.min(html.length, rawAnchor + SEARCH_WINDOW_CHARS);

  const window = html.slice(rawAnchor, rawBound);
  const conjunctiveIdx = window.indexOf('>Conjunctive');
  if (conjunctiveIdx === -1) return { kind: 'not-found' };
  const rowHtml = window.slice(conjunctiveIdx, conjunctiveIdx + 2000);
  const cells = [...rowHtml.matchAll(/<td>([\s\S]*?)<\/td>/g)];
  // Row is <th>Conjunctive</th><td>kanji</td><td>kana-with-spans</td><td>romaji</td>.
  if (cells.length < 2) return { kind: 'not-found' };
  return parseKanaCellPosition(cells[1]![1]!);
}

async function lookupTeFormPitch(expression: string, reading: string): Promise<TeFormLookupResult> {
  const url = `https://en.wiktionary.org/wiki/${encodeURIComponent(expression)}`;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (response.status === 404) return { kind: 'no-page' };
  if (!response.ok) throw new Error(`Wiktionary fetch failed for ${expression}: HTTP ${response.status}`);
  const html = await response.text();
  return extractTeFormAccentPosition(html, reading);
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log('Fetching conjugable verbs with citation accent data but no te-form accent yet...');
  const items = await fetchCandidateItems(supabase, user.id);
  console.log(`Found ${items.length} candidate item(s).`);
  if (!items.length) return;

  let matched = 0;
  let noPage = 0;
  let notFound = 0;

  for (const [index, item] of items.entries()) {
    if (index > 0) await sleep(REQUEST_DELAY_MS);
    const result = await lookupTeFormPitch(item.expression, item.reading);
    if (result.kind === 'no-page') {
      noPage += 1;
      continue;
    }
    if (result.kind === 'not-found') {
      notFound += 1;
      continue;
    }
    matched += 1;
    console.log(`  ${item.expression} [${item.reading}] — te-form position: ${result.position}`);
    if (apply) {
      const { error } = await supabase
        .from('vocabulary_items')
        .update({ te_form_accent_position: result.position })
        .eq('id', item.id);
      if (error) {
        throw new Error(`Failed to update vocabulary_item ${item.id}: ${error.message}`);
      }
    }
  }

  console.log(
    `\nDone. ${matched} item(s) ${apply ? 'updated' : 'would be updated'}, ${noPage} had no Wiktionary page, ${notFound} had no usable Conjunctive row.`,
  );
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
