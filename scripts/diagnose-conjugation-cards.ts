/**
 * Read-only diagnostic: why aren't "Conjugation in context"
 * (`sentence_transformation`) review cards showing up?
 *
 * Replays ReviewPage's `getSentenceConjugationCandidates` + the
 * `getSentenceFullReviewReadiness` gate against Supabase data and prints a
 * funnel: how many surface-form occurrences exist, how many survive each
 * filter, and how many survivors sit behind a not-yet-ready sentence.
 *
 * Usage: npm run diagnose:conjugation-cards
 */
import {
  conjugate,
  conjugationWordClassFromPartOfSpeech,
  findInflectedSurfaceInSentence,
  identifyConjugationForm,
} from '../src/lib/conjugation';
import { surfaceReadingFromInline } from '../src/lib/readingAnswer';
import {
  isSentenceReadyForFullReview,
  isVocabularyItemProficient,
} from '../src/lib/scheduling';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function main() {
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const [links, sentences, vocab, analyses, studyItems] = await Promise.all([
    fetchAll(
      supabase,
      'sentence_vocabulary',
      'id, sentence_id, vocabulary_item_id, surface_form',
      user.id,
      (r) => ({
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
    fetchAll(
      supabase,
      'analyses',
      'sentence_id, vocabulary_review_status',
      user.id,
      (r) => ({
        sentenceId: String(r.sentence_id),
        status:
          (r.vocabulary_review_status as 'unreviewed' | 'confirmed' | undefined) ??
          'unreviewed',
      }),
      'sentence_id',
    ),
    fetchAll(
      supabase,
      'study_items',
      'id, subject_id, subject_type, activity_type, fsrs_state',
      user.id,
      (r) => ({
        subjectId: String(r.subject_id),
        subjectType: String(r.subject_type),
        activityType: String(r.activity_type),
        state: (r.fsrs_state as { state: string } | null)?.state ?? 'new',
      }),
    ),
  ]);

  const sentenceById = new Map(sentences.map((s) => [s.id, s]));
  const vocabById = new Map(vocab.map((v) => [v.id, v]));
  const statusBySentence = new Map(analyses.map((a) => [a.sentenceId, a.status]));
  const proficientVocabIds = new Set(
    studyItems
      .filter(
        (it) =>
          it.subjectType === 'vocabularyItem' &&
          isVocabularyItemProficient(it.state as never),
      )
      .map((it) => it.subjectId),
  );

  // POS-format census over all vocab.
  let jmdictPos = 0;
  let otherPos = 0;
  let noPos = 0;
  for (const v of vocab) {
    if (!v.partOfSpeech) noPos += 1;
    else if (conjugationWordClassFromPartOfSpeech(v.partOfSpeech)) jmdictPos += 1;
    else otherPos += 1;
  }

  // Conjugation-candidate funnel, per surface-form-bearing link.
  const surfLinks = links.filter((l) => l.surfaceForm);
  let noWordClass = 0;
  let notASingleForm = 0;
  let noReading = 0;
  let candidates = 0;
  const candidateSentenceIds = new Set<string>();
  for (const link of surfLinks) {
    const v = vocabById.get(link.vocabularyItemId);
    const s = sentenceById.get(link.sentenceId);
    if (!v || !s || !link.surfaceForm) continue;
    const wordClass = conjugationWordClassFromPartOfSpeech(v.partOfSpeech ?? undefined);
    if (!wordClass) {
      noWordClass += 1;
      continue;
    }
    let surface = link.surfaceForm;
    let formKey = identifyConjugationForm(
      v.expression,
      v.reading,
      wordClass,
      surface,
      surfaceReadingFromInline(s.inlineReading, surface) ?? undefined,
    )?.form.key;
    if (!formKey) {
      const resolved = findInflectedSurfaceInSentence(
        s.japanese,
        v.expression,
        v.reading,
        wordClass,
      );
      if (resolved && resolved.surface !== surface && resolved.surface.startsWith(surface)) {
        surface = resolved.surface;
        formKey = resolved.form.key;
      }
    }
    if (!formKey) {
      notASingleForm += 1;
      continue;
    }
    const inCtx = surfaceReadingFromInline(s.inlineReading, surface);
    const engineReading = conjugate(v.expression, v.reading, wordClass, formKey)?.reading;
    if (![inCtx, engineReading].some(Boolean)) {
      noReading += 1;
      continue;
    }
    candidates += 1;
    candidateSentenceIds.add(link.sentenceId);
  }

  // Full-review-readiness gate over the sentences that have a candidate.
  let readySentences = 0;
  let notConfirmed = 0;
  let vocabNotProficient = 0;
  for (const sentenceId of candidateSentenceIds) {
    const status = statusBySentence.get(sentenceId);
    const vocabIds = [
      ...new Set(
        surfLinks
          .filter((l) => l.sentenceId === sentenceId)
          .map((l) => l.vocabularyItemId),
      ),
    ];
    if (isSentenceReadyForFullReview(status, vocabIds, proficientVocabIds)) readySentences += 1;
    else if (status !== 'confirmed') notConfirmed += 1;
    else vocabNotProficient += 1;
  }

  const existingConj = studyItems.filter((it) => it.activityType === 'sentence_transformation');

  console.log('=== Vocabulary POS format ===');
  console.log(`  total vocabulary_items:            ${vocab.length}`);
  console.log(`  JMdict tags (conjugatable class):  ${jmdictPos}`);
  console.log(`  other/UniDic POS (unrecognised):   ${otherPos}`);
  console.log(`  no part_of_speech at all:          ${noPos}`);
  console.log();
  console.log('=== Existing sentence_transformation study_items ===');
  console.log(`  ${existingConj.length}`);
  console.log();
  console.log('=== Conjugation candidate funnel ===');
  console.log(`  surface-form-bearing links:        ${surfLinks.length}`);
  console.log(`  - dropped: POS not a conj class:   ${noWordClass}`);
  console.log(`  - dropped: not a single clean form:${notASingleForm}`);
  console.log(`  - dropped: no derivable reading:   ${noReading}`);
  console.log(`  => conjugation candidates:         ${candidates}`);
  console.log(`     across distinct sentences:      ${candidateSentenceIds.size}`);
  console.log();
  console.log('=== Full-review-readiness gate on those sentences ===');
  console.log(`  ready now (card can seed):         ${readySentences}`);
  console.log(`  blocked: vocab not confirmed:      ${notConfirmed}`);
  console.log(`  blocked: some vocab not proficient:${vocabNotProficient}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
