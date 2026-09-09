/**
 * Fixes `sentence_vocabulary.surface_form` values the VocabularyPicker
 * truncated to a bare conjugation stem — 言っ for 言って, 思わ for 思わない,
 * 大き for 大きく. The picker captures the content morpheme UniDic
 * segmented, which drops the trailing auxiliary; the stored value is then
 * not a real word, which:
 *   - makes the occurrence ineligible for the contextual conjugation card
 *     unless ReviewPage's read-time recovery kicks in
 *     (`findInflectedSurfaceInSentence`), and
 *   - shows the stem (言っ) as the answer / cloze target on the
 *     reading_retrieval / cloze / reading_production / word_listening /
 *     pitch_accent cards.
 *
 * For each link whose word maps to a conjugation word class
 * (src/lib/conjugation.ts), where `identifyConjugationForm` does *not*
 * already recognise the stored surface but the sentence contains a single
 * conjugated form that has the stored surface as a strict prefix, rewrite
 * `surface_form` to that full form. Anything else is left alone — a stem
 * that isn't a clean prefix of one engine-produced form (stacked auxiliary
 * chains, volitional, たい) is not touched.
 *
 * Run this AFTER `backfill:vocabulary-jmdict-pos` so POS-unlocked verbs are
 * in scope. Dry-run by default; --apply required to write. Idempotent: a
 * fixed row's surface then identifies and is skipped next run.
 *
 * Usage: npm run fix:truncated-surface-forms -- [--apply]
 */
import {
  conjugationWordClassFromPartOfSpeech,
  findInflectedSurfaceInSentence,
  identifyConjugationForm,
} from '../src/lib/conjugation';
import { surfaceReadingFromInline } from '../src/lib/readingAnswer';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log('Fetching links, sentences and vocabulary items...');
  const [links, sentences, vocab] = await Promise.all([
    fetchAll(
      supabase,
      'sentence_vocabulary',
      'id, sentence_id, vocabulary_item_id, surface_form',
      user.id,
      (r) => ({
        id: String(r.id),
        sentenceId: String(r.sentence_id),
        vocabularyItemId: String(r.vocabulary_item_id),
        surfaceForm: r.surface_form ? String(r.surface_form) : null,
      }),
    ),
    fetchAll(supabase, 'sentences', 'id, japanese, inline_reading', user.id, (r) => ({
      id: String(r.id),
      japanese: String(r.japanese ?? ''),
      inlineReading: r.inline_reading ? String(r.inline_reading) : '',
    })),
    fetchAll(
      supabase,
      'vocabulary_items',
      'id, expression, reading, part_of_speech',
      user.id,
      (r) => ({
        id: String(r.id),
        expression: String(r.expression ?? ''),
        reading: String(r.reading ?? ''),
        partOfSpeech: r.part_of_speech ? String(r.part_of_speech) : null,
      }),
    ),
  ]);
  const sentenceById = new Map(sentences.map((s) => [s.id, s]));
  const vocabById = new Map(vocab.map((v) => [v.id, v]));

  let fixed = 0;
  for (const link of links) {
    if (!link.surfaceForm) continue;
    const v = vocabById.get(link.vocabularyItemId);
    const s = sentenceById.get(link.sentenceId);
    if (!v || !s) continue;
    const wordClass = conjugationWordClassFromPartOfSpeech(v.partOfSpeech ?? undefined);
    if (!wordClass) continue;

    const alreadyOk = identifyConjugationForm(
      v.expression,
      v.reading,
      wordClass,
      link.surfaceForm,
      surfaceReadingFromInline(s.inlineReading, link.surfaceForm) ?? undefined,
    );
    if (alreadyOk) continue;

    const resolved = findInflectedSurfaceInSentence(
      s.japanese,
      v.expression,
      v.reading,
      wordClass,
    );
    if (
      !resolved ||
      resolved.surface === link.surfaceForm ||
      !resolved.surface.startsWith(link.surfaceForm)
    ) {
      continue;
    }

    fixed += 1;
    console.log(
      `  ${v.expression}: "${link.surfaceForm}" -> "${resolved.surface}" (${resolved.form.key})  in ${s.japanese}`,
    );
    if (apply) {
      const { error } = await supabase
        .from('sentence_vocabulary')
        .update({ surface_form: resolved.surface })
        .eq('id', link.id);
      if (error) {
        throw new Error(`Failed to update sentence_vocabulary ${link.id}: ${error.message}`);
      }
    }
  }

  console.log(`\nDone. ${fixed} link(s) ${apply ? 'updated' : 'would be updated'}.`);
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
