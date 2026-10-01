/**
 * Read-only audit: does each sentence's furigana match what the speaker
 * actually says? Walks every stored reference alignment (`reference_alignment`),
 * finds the aligner word for each ruby span (MFA picked whichever dictionary
 * pronunciation best fit the audio — 何 → なに vs なん), converts that word's
 * phones to kana, and reports spans where the heard kana differs from the
 * ruby reading. Writes nothing.
 *
 * Usage: npx tsx scripts/audit-reading-vs-alignment.ts [--limit N] [--show N]
 */
import type { WordAlignment } from '../src/domain/types';
import { phonesToSoundedMorae } from '../src/lib/moraTiming';
import { parseInlineReadings } from '../src/lib/parseInlineReadings';

import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const SILENCE = new Set(['', '<eps>', '<unk>', '<sil>', '<pad>', 'sil', 'sp', 'spn']);

const toHiragana = (s: string) =>
  s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

const VOWEL_OF: Record<string, string> = {};
for (const [vowel, row] of Object.entries({
  あ: 'あかがさざただなはばぱまやゃらわ',
  い: 'いきぎしじちぢにひびぴみり',
  う: 'うくぐすずつづぬふぶぷむゆゅる',
  え: 'えけげせぜてでねへべぺめれ',
  お: 'おこごそぞとどのほぼぽもよょろをょ',
})) {
  for (const ch of row) VOWEL_OF[ch] = vowel;
}

// Collapse vowel-length spellings (せつめー / せつめい, おもー / おもう,
// きょー / きょう) so only genuine kana differences remain.
function normalize(kana: string): string {
  const chars = [...toHiragana(kana)];
  const out: string[] = [];
  for (const ch of chars) {
    const prev = out[out.length - 1];
    const prevVowel = prev ? (prev === 'ー' ? undefined : VOWEL_OF[prev]) : undefined;
    if (ch === 'ー' && prevVowel) out.push(prevVowel);
    else if (ch === 'う' && (prevVowel === 'お' || prevVowel === 'う')) out.push(prevVowel);
    else if (ch === 'い' && (prevVowel === 'え' || prevVowel === 'い')) out.push(prevVowel);
    else if (ch === 'お' && prevVowel === 'お') out.push('お');
    else out.push(ch);
  }
  return out.join('');
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (flag: string, fallback: number) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
  };
  const limit = arg('--limit', Infinity);
  const show = arg('--show', 40);

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const audioRows = await fetchAll<{ id: string; sentenceId: string }>(
    supabase,
    'reference_audio',
    'id, sentence_id',
    user.id,
    (r) => ({ id: String(r.id), sentenceId: String(r.sentence_id ?? '') }),
  );
  const sentenceByAudio = new Map(audioRows.map((a) => [a.id, a.sentenceId]));
  const sentences = await fetchAll<{ id: string; inline: string; japanese: string }>(
    supabase,
    'sentences',
    'id, japanese, inline_reading',
    user.id,
    (r) => ({
      id: String(r.id),
      japanese: String(r.japanese ?? ''),
      inline: String(r.inline_reading ?? ''),
    }),
  );
  const sentenceById = new Map(sentences.map((s) => [s.id, s]));

  const alignments: { id: string; words: WordAlignment[] }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('reference_alignment')
      .select('id, alignment')
      .eq('owner_id', user.id)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const words = (row.alignment as { words?: WordAlignment[] })?.words;
      if (Array.isArray(words)) alignments.push({ id: String(row.id), words });
    }
    if (!data || data.length < 1000) break;
  }

  let spans = 0;
  let matched = 0;
  let agree = 0;
  const disagreements = new Map<string, { count: number; example: string }>();

  for (const { id, words } of alignments.slice(0, limit === Infinity ? undefined : limit)) {
    const sentence = sentenceById.get(sentenceByAudio.get(id) ?? '');
    if (!sentence?.inline) continue;
    const audible = words.filter((w) => !SILENCE.has(w.text));
    let cursor = 0;
    for (const seg of parseInlineReadings(sentence.inline)) {
      if (seg.kind !== 'ruby' || !seg.reading) continue;
      spans += 1;
      const at = audible.findIndex((w, i) => i >= cursor && w.text === seg.base);
      if (at < 0) continue;
      cursor = at + 1;
      const morae = phonesToSoundedMorae(audible[at]!.phones);
      if (!morae) continue;
      matched += 1;
      const heard = normalize(morae.map((m) => m.kana).join(''));
      const written = normalize(seg.reading);
      if (heard === written) {
        agree += 1;
        continue;
      }
      const key = `${seg.base}\t written ${seg.reading}\t heard ${morae.map((m) => m.kana).join('')}`;
      const entry = disagreements.get(key) ?? { count: 0, example: sentence.japanese };
      entry.count += 1;
      disagreements.set(key, entry);
    }
  }

  const total = [...disagreements.values()].reduce((n, e) => n + e.count, 0);
  console.log(
    `${alignments.length} alignments; ${spans} ruby spans, ${matched} matched to an aligner word, ` +
      `${agree} agree, ${total} disagree (${disagreements.size} distinct).\n`,
  );
  const ranked = [...disagreements.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [key, { count, example }] of ranked.slice(0, show)) {
    console.log(`${String(count).padStart(4)}×  ${key}\n        e.g. ${example}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
