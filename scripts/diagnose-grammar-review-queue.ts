/**
 * Read-only diagnostic: why aren't grammar review cards showing up even
 * though grammar study_items read as due?
 *
 * Reproduces ReviewPage's grammar-candidate build (src/pages/ReviewPage.tsx
 * ~L935-1055) + pickContextSentenceForGrammarPattern
 * (src/db/repository.ts L4239): a tracked pattern produces NO card of any
 * type unless one of its sentence_grammar-linked sentences passes
 * getSentenceFullReviewReadiness (vocabulary_review_status === 'confirmed'
 * AND every surface-form vocab item in that sentence FSRS-proficient). If
 * none qualifies, the whole pattern is dropped before the due-check runs.
 *
 * Usage: npx tsx scripts/diagnose-grammar-review-queue.ts
 */
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;

async function fetchAll(
  supabase: any,
  table: string,
  columns: string,
  { includeDeleted = false } = {},
): Promise<Row[]> {
  const rows: Row[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    let query = supabase.from(table).select(columns).range(from, from + page - 1);
    if (!includeDeleted) query = query.is('deleted_at', null);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < page) break;
    from += page;
  }
  return rows;
}

const PROFICIENT = new Set(['review', 'relearning']);
const GRAMMAR_ACTIVITY_TYPES = ['grammar_comprehension', 'grammar_completion'];
const ALL_GRAMMAR_ACTIVITY_TYPES = [
  ...GRAMMAR_ACTIVITY_TYPES,
  'grammar_contrast',
  'grammar_production',
];

async function main() {
  const supabase = await createScriptSupabaseClient();
  const nowIso = new Date().toISOString();

  const [patterns, allLinks, sentences, sentenceVocab, analyses, studyItems] = await Promise.all([
    fetchAll(supabase, 'grammar_patterns', 'id, canonical_name, short_meaning'),
    fetchAll(supabase, 'sentence_grammar', 'grammar_pattern_id, sentence_id, created_at, deleted_at', {
      includeDeleted: true,
    }),
    fetchAll(supabase, 'sentences', 'id, deleted_at', { includeDeleted: true }),
    fetchAll(supabase, 'sentence_vocabulary', 'sentence_id, vocabulary_item_id, surface_form'),
    fetchAll(supabase, 'analyses', 'sentence_id, vocabulary_review_status'),
    fetchAll(supabase, 'study_items', 'id, subject_type, subject_id, activity_type, fsrs_state'),
  ]);
  const sentenceDeleted = new Map(sentences.map((s) => [s.id, !!s.deleted_at]));
  const links = allLinks.filter((l) => !l.deleted_at);

  const patternById = new Map(patterns.map((p) => [p.id, p]));

  // vocab item -> proficient?
  const proficientVocab = new Set<string>();
  for (const it of studyItems) {
    if (it.subject_type === 'vocabularyItem' && PROFICIENT.has(it.fsrs_state?.state)) {
      proficientVocab.add(it.subject_id);
    }
  }

  // sentence -> reviewable (surface-form) vocab item ids
  const reviewableVocabBySentence = new Map<string, Set<string>>();
  for (const link of sentenceVocab) {
    if (!link.surface_form) continue;
    let set = reviewableVocabBySentence.get(link.sentence_id);
    if (!set) reviewableVocabBySentence.set(link.sentence_id, (set = new Set()));
    set.add(link.vocabulary_item_id);
  }

  const reviewStatusBySentence = new Map(
    analyses.map((a) => [a.sentence_id, a.vocabulary_review_status ?? 'unreviewed']),
  );

  function sentenceReadiness(sentenceId: string): {
    ready: boolean;
    confirmed: boolean;
    unproficient: string[];
  } {
    const confirmed = reviewStatusBySentence.get(sentenceId) === 'confirmed';
    const vocab = [...(reviewableVocabBySentence.get(sentenceId) ?? [])];
    const unproficient = vocab.filter((id) => !proficientVocab.has(id));
    return { ready: confirmed && unproficient.length === 0, confirmed, unproficient };
  }

  // pattern -> linked sentence ids, newest first (matches repository sort)
  const linksByPattern = new Map<string, Row[]>();
  for (const link of links) {
    const arr = linksByPattern.get(link.grammar_pattern_id) ?? [];
    arr.push(link);
    linksByPattern.set(link.grammar_pattern_id, arr);
  }

  // grammar study items by pattern
  const grammarItemsByPattern = new Map<string, Row[]>();
  for (const it of studyItems) {
    if (it.subject_type !== 'grammarPattern') continue;
    if (!ALL_GRAMMAR_ACTIVITY_TYPES.includes(it.activity_type)) continue;
    const arr = grammarItemsByPattern.get(it.subject_id) ?? [];
    arr.push(it);
    grammarItemsByPattern.set(it.subject_id, arr);
  }

  let trackedCount = 0;
  let dueCount = 0;
  const stuck: string[] = [];
  const working: string[] = [];

  for (const [patternId, items] of grammarItemsByPattern) {
    trackedCount++;
    const pattern = patternById.get(patternId);
    const name = pattern?.canonical_name ?? patternId;
    const dueItems = items.filter((it) => (it.fsrs_state?.due ?? '') <= nowIso);
    const dueTypes = dueItems.map((it) => it.activity_type).sort();
    if (dueItems.length > 0) dueCount++;

    const patternLinks = (linksByPattern.get(patternId) ?? []).sort((a, b) =>
      String(b.created_at).localeCompare(String(a.created_at)),
    );

    let context: { sentenceId: string } | undefined;
    const failReasons: string[] = [];
    for (const link of patternLinks) {
      const r = sentenceReadiness(link.sentence_id);
      if (r.ready) {
        context = { sentenceId: link.sentence_id };
        break;
      }
      failReasons.push(
        `    sentence ${link.sentence_id.slice(0, 8)}: ${
          !r.confirmed ? 'vocab not confirmed' : `${r.unproficient.length} vocab item(s) not proficient`
        }`,
      );
    }

    if (patternLinks.length === 0) {
      const deleted = allLinks.filter((l) => l.grammar_pattern_id === patternId && l.deleted_at);
      const orphanedByDeletedSentence = deleted.some((l) => sentenceDeleted.get(l.sentence_id));
      stuck.push(
        `✗ ${name}\n  due: [${dueTypes.join(', ') || 'none'}] — 0 live sentence_grammar links` +
          (deleted.length
            ? ` (${deleted.length} soft-deleted${orphanedByDeletedSentence ? ', sentence was deleted → ORPHANED study item' : ''})`
            : ' (never had one)'),
      );
      continue;
    }
    if (!context) {
      stuck.push(
        `✗ ${name}\n  due: [${dueTypes.join(', ') || 'none'}]  (${patternLinks.length} linked sentence(s), none ready)\n${failReasons.join('\n')}`,
      );
    } else if (dueItems.length > 0) {
      working.push(`✓ ${name} — due [${dueTypes.join(', ')}], context ok`);
    }
  }

  console.log(`\ngrammar patterns with study items: ${trackedCount}`);
  console.log(`  ...with at least one due card: ${dueCount}`);
  console.log(`  ...stuck (due card(s) but no ready context sentence): ${stuck.filter((s) => !s.includes('due: [none]')).length}\n`);

  console.log('=== STUCK ===');
  for (const s of stuck) console.log(s + '\n');

  console.log('=== WORKING (due + would show) ===');
  for (const w of working) console.log(w);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
