/**
 * Read-only diagnostic: how much of each sentence gets H/L pitch-accent marks (the ambient
 * `getSentencePitchAccentTargets` → `buildSentencePitchAccents` view), and why the rest is unmarked.
 * Nothing is written.
 *
 * Every morphology suggestion of a sentence is one token. A token counts as MARKED when a
 * sentence_vocabulary link covers it and `resolveInflectedPitchAccent` (the same resolver the UI uses)
 * returns a position. Unmarked content tokens are bucketed by cause:
 *   linked_no_accent_data   linked vocab item has no pitch_accent_positions
 *   linked_unresolved       linked, has data, but resolver declined (inflection outside its coverage)
 *   unlinked_kanjium_hit    no link, citation-form token, Kanjium has expression+reading (a lookup would mark it)
 *   unlinked_inflected_recovered  same, inflected, and the word-class inference + shift resolver places it (marked at render)
 *   unlinked_kanjium_inflected  inflected and the resolver cannot place it (te-form, unsupported form, ...)
 *   unlinked_reading_only_hit   citation-form, no expression match, but every Kanjium entry for the reading agrees
 *   unlinked_no_data        no link and Kanjium has nothing
 * Non-content tokens (particles, auxiliaries, the picker's default-unchecked set) are reported apart.
 * Figures are tokens and morae (a mora-weighted view matches "how much of the line is marked").
 *
 * Usage: npm run diagnose:pitch-mark-coverage [-- --introduced] [--top 25]
 *   --introduced  restrict to sentences the learner has been introduced to
 */
import type { Sentence, VocabularyItem, VocabularySuggestion } from '../src/domain/types';
import { buildKanjiumPitchLookup, findLemmaPitch, kanjiumTargetsForSuggestions } from '../src/lib/kanjiumPitchLookup';
import { segmentIntoMorae } from '../src/lib/mora';
import { resolveInflectedPitchAccent } from '../src/lib/pitchAccentShift';
import { ensureKanjiumPitchIndex, katakanaToHiragana, lookupKanjiumPitch } from './lib/kanjiumPitch';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const CAUSES = [
  'marked',
  'linked_no_accent_data',
  'linked_unresolved',
  'unlinked_kanjium_hit',
  'unlinked_inflected_recovered',
  'unlinked_kanjium_inflected',
  'unlinked_reading_only_hit',
  'unlinked_no_data',
  'non_content',
] as const;
type Cause = (typeof CAUSES)[number];

interface Tally {
  tokens: number;
  morae: number;
}
const blank = (): Record<Cause, Tally> =>
  Object.fromEntries(CAUSES.map((c) => [c, { tokens: 0, morae: 0 }])) as Record<Cause, Tally>;

function pct(n: number, d: number): string {
  return d === 0 ? '   -  ' : `${((100 * n) / d).toFixed(1).padStart(5)}%`;
}

function printTable(title: string, t: Record<Cause, Tally>): void {
  const total = CAUSES.reduce((a, c) => ({ tokens: a.tokens + t[c].tokens, morae: a.morae + t[c].morae }), { tokens: 0, morae: 0 });
  console.log(`\n${title}  (tokens ${total.tokens}, morae ${total.morae})`);
  console.log('  cause'.padEnd(28) + 'tokens'.padStart(8) + '  share' + 'morae'.padStart(9) + '  share');
  for (const c of CAUSES) {
    console.log(
      `  ${c}`.padEnd(28) +
        String(t[c].tokens).padStart(8) + '  ' + pct(t[c].tokens, total.tokens) +
        String(t[c].morae).padStart(9) + '  ' + pct(t[c].morae, total.morae),
    );
  }
}

async function main(): Promise<void> {
  const top = Number(flag('top') ?? 25);
  const introducedOnly = process.argv.includes('--introduced');
  const client = await createScriptSupabaseClient();
  const { id: ownerId } = await requireAuthedUser(client);
  const [sentences, links, vocab, bookSentences, events, studyItems] = await Promise.all([
    fetchAll<Row>(client, 'sentences', 'id,japanese,inline_reading,vocabulary_suggestions', ownerId, (r) => r),
    fetchAll<Row>(client, 'sentence_vocabulary', 'id,sentence_id,vocabulary_item_id,surface_form', ownerId, (r) => r),
    fetchAll<Row>(
      client,
      'vocabulary_items',
      'id,expression,reading,part_of_speech,pitch_accent_positions,te_form_accent_position',
      ownerId,
      (r) => r,
    ),
    fetchAll<Row>(client, 'book_sentences', 'id,sentence_id,status', ownerId, (r) => r),
    fetchAll<Row>(client, 'sentence_learning_events', 'id,sentence_id,action', ownerId, (r) => r),
    fetchAll<Row>(client, 'study_items', 'id,subject_id,subject_type', ownerId, (r) => r),
  ]);
  const kanjium = await ensureKanjiumPitchIndex();
  // reading -> position, only where every Kanjium entry with that reading agrees (safe for kana-written lemmas).
  const byReading = new Map<string, Set<string>>();
  for (const [key, positions] of kanjium) {
    const reading = key.slice(key.indexOf('|') + 1);
    const set = byReading.get(reading) ?? new Set<string>();
    set.add(positions.join(','));
    byReading.set(reading, set);
  }
  const lookup = buildKanjiumPitchLookup(Object.fromEntries([...kanjium].map(([key, positions]) => [key, positions.join(',')])));
  const unambiguousByReading = new Map<string, number>();
  for (const [reading, set] of byReading) if (set.size === 1) unambiguousByReading.set(reading, Number([...set][0]!.split(',')[0]));

  const introduced = new Set<string>();
  for (const e of events) if (e.action === 'walkthrough_completed') introduced.add(e.sentence_id);
  for (const b of bookSentences) if (b.status !== 'unstarted') introduced.add(b.sentence_id);
  for (const i of studyItems) if (i.subject_type === 'sentence') introduced.add(i.subject_id);

  const vocabById = new Map<string, Row>(vocab.map((v) => [v.id as string, v]));
  const linksBySentence = new Map<string, Row[]>();
  for (const l of links) {
    const list = linksBySentence.get(l.sentence_id) ?? [];
    list.push(l);
    linksBySentence.set(l.sentence_id, list);
  }

  const overall = blank();
  const byPos = new Map<string, Record<Cause, Tally>>();
  const missingWords = new Map<string, { count: number; cause: Cause; reading: string; surfaces: Set<string> }>();
  const sentenceCoverage: number[] = [];
  let scanned = 0;
  let untokenized = 0;

  for (const s of sentences) {
    if (introducedOnly && !introduced.has(s.id)) continue;
    const suggestions = ((s.vocabulary_suggestions ?? []) as VocabularySuggestion[]).filter(
      (x) => x.source === 'morphology' || x.source === undefined,
    );
    if (suggestions.length === 0) {
      untokenized += 1;
      continue;
    }
    scanned += 1;
    const sentence = { japanese: s.japanese, inlineReading: s.inline_reading ?? undefined } as Pick<Sentence, 'japanese' | 'inlineReading'>;
    const sentenceLinks = linksBySentence.get(s.id) ?? [];
    let contentMorae = 0;
    let markedMorae = 0;

    for (const token of suggestions) {
      const morae = segmentIntoMorae(token.reading || token.surface).length;
      let cause: Cause;
      if (!token.selectedByDefault) {
        cause = 'non_content';
      } else {
        const link = sentenceLinks.find((l) => {
          const item = vocabById.get(l.vocabulary_item_id);
          if (!item) return false;
          if (l.surface_form && l.surface_form === token.surface) return true;
          return item.expression === token.expression && (!token.reading || item.reading === token.reading);
        });
        const item = link ? vocabById.get(link.vocabulary_item_id) : undefined;
        if (link && item) {
          if (!item.pitch_accent_positions?.length) {
            cause = 'linked_no_accent_data';
          } else {
            const resolved = resolveInflectedPitchAccent({
              vocabularyItem: {
                expression: item.expression,
                reading: item.reading,
                partOfSpeech: item.part_of_speech ?? undefined,
                pitchAccentPositions: item.pitch_accent_positions,
                teFormAccentPosition: item.te_form_accent_position ?? undefined,
              } as Pick<VocabularyItem, 'expression' | 'reading' | 'partOfSpeech' | 'pitchAccentPositions' | 'teFormAccentPosition'>,
              sentence,
              surfaceForm: link.surface_form ?? token.surface,
            });
            cause = resolved ? 'marked' : 'linked_unresolved';
          }
        } else {
          // A verb/adjective whose stored reading is the inflected one (する→し) is recovered through its lemma reading.
          const lemma = findLemmaPitch(lookup, token);
          const hit =
            lookupKanjiumPitch(kanjium, token.expression, token.reading ?? '') ??
            (lemma && lemma.reading !== token.reading ? lemma.positions : undefined);
          const citation = token.surface === token.expression || token.surface === (lemma?.reading ?? token.reading);
          const readingOnly = unambiguousByReading.get(katakanaToHiragana(token.reading ?? ''));
          cause = hit
            ? citation
              ? 'unlinked_kanjium_hit'
              : kanjiumTargetsForSuggestions([token], lookup, new Set(), sentence).length > 0
                ? 'unlinked_inflected_recovered'
                : 'unlinked_kanjium_inflected'
            : readingOnly !== undefined && citation
              ? 'unlinked_reading_only_hit'
              : 'unlinked_no_data';
        }
        contentMorae += morae;
        if (cause === 'marked') markedMorae += morae;
        if (cause !== 'marked') {
          const key = `${token.expression}\t${token.pos}`;
          const prev = missingWords.get(key);
          if (prev) {
            prev.count += 1;
            prev.surfaces.add(token.surface);
          }
          else missingWords.set(key, { count: 1, cause, reading: token.reading ?? '', surfaces: new Set([token.surface]) });
        }
      }
      overall[cause].tokens += 1;
      overall[cause].morae += morae;
      const posKey = token.pos || '?';
      if (!byPos.has(posKey)) byPos.set(posKey, blank());
      byPos.get(posKey)![cause].tokens += 1;
      byPos.get(posKey)![cause].morae += morae;
    }
    if (contentMorae > 0) sentenceCoverage.push(markedMorae / contentMorae);
  }

  console.log(`Scope: ${introducedOnly ? 'introduced sentences' : 'all sentences'} — scanned ${scanned}, untokenized (skipped) ${untokenized}`);
  printTable('All tokens', overall);

  const content = blank();
  for (const c of CAUSES) if (c !== 'non_content') content[c] = overall[c];
  printTable('Content tokens only (non_content excluded)', content);

  console.log('\nContent-token coverage by POS (marked share of tokens / morae, n tokens):');
  const rows = [...byPos.entries()]
    .map(([pos, t]) => {
      const tokens = CAUSES.filter((c) => c !== 'non_content').reduce((a, c) => a + t[c].tokens, 0);
      const morae = CAUSES.filter((c) => c !== 'non_content').reduce((a, c) => a + t[c].morae, 0);
      return { pos, tokens, morae, t };
    })
    .filter((r) => r.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
  for (const r of rows) {
    const unmarked = CAUSES.filter((c) => c !== 'marked' && c !== 'non_content')
      .map((c) => `${c}=${r.t[c].tokens}`)
      .join(' ');
    console.log(`  ${r.pos.padEnd(14)} n=${String(r.tokens).padStart(6)}  tokens ${pct(r.t.marked.tokens, r.tokens)}  morae ${pct(r.t.marked.morae, r.morae)}   ${unmarked}`);
  }

  sentenceCoverage.sort((a, b) => a - b);
  const q = (p: number): string => `${(100 * (sentenceCoverage[Math.floor(p * (sentenceCoverage.length - 1))] ?? 0)).toFixed(0)}%`;
  console.log(`\nPer-sentence marked share of content morae: p10 ${q(0.1)}  p25 ${q(0.25)}  median ${q(0.5)}  p75 ${q(0.75)}  (n=${sentenceCoverage.length})`);
  console.log(`Sentences with 0% of content morae marked: ${sentenceCoverage.filter((x) => x === 0).length}`);

  console.log(`\nTop ${top} most frequent unmarked content words:`);
  for (const [key, v] of [...missingWords.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, top)) {
    const [expression, pos] = key.split('\t');
    console.log(`  ${String(v.count).padStart(5)}  ${expression} (${v.reading}) [${pos}]  ${v.cause}  surfaces: ${[...v.surfaces].slice(0, 6).join(' ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
