/**
 * Folds near-duplicate grammar_patterns together and tags non-construction entries `family = no-auto-link` so the
 * book assistant's grammar extra does not link sentences to them (2026-10-31 cleanup, approved group by group).
 *
 * For each group the pattern with the most encounters survives and is renamed to the group's canonical name; the
 * old names (and aliases) become aliases. sentence_grammar links are repointed (or, when the survivor already has a
 * link for that sentence, merged into it and soft-deleted), pattern study_items are repointed, then the losing
 * patterns are soft-deleted. A group with a card collision or a relationship is skipped and reported, not guessed.
 * Rows are soft-deleted, never hard-deleted, so other devices learn of the change through sync.
 *
 * Dry-run by default; --apply required to write. Idempotent: merged members no longer exist on the next run.
 *
 * Usage: npm run merge:grammar-patterns -- [--apply]
 */
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import {
  NO_AUTO_LINK_FAMILY,
  planGrammarMerge,
  type LinkRow,
  type MergeGroup,
  type PatternRow,
  type PatternStudyItemRow,
  type RelationshipRow,
} from './lib/grammarPatternMerge';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const GROUPS: MergeGroup[] = [
  {
    canonical: '～ている',
    keep: '～ている（状態描写）',
    shortMeaning: 'Ongoing action or resulting state: V-て + いる (polite いる→います, casual てる/てん)',
    members: ['～ていました（過去進行）', '～ています（現在進行）', '～ている（状態描写）', '～てる', '～てん（ている → てる → てん）'],
  },
  { canonical: '～んだ', members: ['～ん (contraction of ～のだ)', '～んだ', '～んです'] },
  { canonical: '～ですか？', members: ['～ですか? (polite question)', '～ですか?（丁寧な疑問）'] },
  { canonical: '～な。（感動・驚き）', members: ['～な、～。（感動・驚き）', '～な。（感動・驚き）'] },
  { canonical: '～て初めて', members: ['～て初めて', '初めて (～て初めて)'] },
  { canonical: '火を点ける', members: ['～に火を点ける', '火を点ける'] },
];

const FLAG_NAMES = [
  '今、～', '今日は～。', '今日も', '昨日（yesterday as temporal adverbial）', '～が（主語焦点）', '～で',
  'おいくつ (polite form of 何歳)', 'さあ', 'じゃあ', 'しゃっ！', 'すごい', 'それで', 'それより', 'ちょっと', 'どう', 'どうも',
  'みなさん', '一生懸命に', '～です', '～です (copula/predicate ending)', '～ました (past tense copula)', '～ました（過去）',
];

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const [patterns, links, studyItems, relationships] = await Promise.all([
    fetchAll(supabase, 'grammar_patterns', 'id, canonical_name, aliases, family', user.id, (row): PatternRow => ({
      id: String(row.id),
      canonicalName: String(row.canonical_name),
      aliases: Array.isArray(row.aliases) ? (row.aliases as unknown[]).map(String) : [],
      family: row.family ? String(row.family) : null,
    })),
    fetchAll(
      supabase,
      'sentence_grammar',
      'id, sentence_id, grammar_pattern_id, surface_form, occurrence_explanation, confirmed_by_learner',
      user.id,
      (row): LinkRow => ({
        id: String(row.id),
        sentenceId: String(row.sentence_id),
        patternId: String(row.grammar_pattern_id),
        surfaceForm: row.surface_form ? String(row.surface_form) : null,
        occurrenceExplanation: row.occurrence_explanation ? String(row.occurrence_explanation) : null,
        confirmedByLearner: Boolean(row.confirmed_by_learner),
      }),
    ),
    fetchAll(supabase, 'study_items', 'id, subject_id, subject_type, activity_type', user.id, (row) => ({
      id: String(row.id),
      subjectId: String(row.subject_id),
      subjectType: String(row.subject_type),
      activityType: String(row.activity_type),
    })).then((rows): PatternStudyItemRow[] => rows.filter((row) => row.subjectType === 'grammarPattern')),
    fetchAll(supabase, 'grammar_relationships', 'id, pattern_a_id, pattern_b_id', user.id, (row): RelationshipRow => ({
      id: String(row.id),
      patternAId: String(row.pattern_a_id),
      patternBId: String(row.pattern_b_id),
    })),
  ]);

  const plan = planGrammarMerge({ patterns, links, studyItems, relationships, groups: GROUPS, flagNames: FLAG_NAMES });
  for (const problem of plan.problems) console.log(`NOTE: ${problem}`);

  const now = () => new Date().toISOString();
  const check = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };

  for (const group of plan.groups) {
    console.log(`\n--- ${group.canonical}: keep "${group.survivor.canonicalName}", fold in ${group.losers.map((l) => `"${l.canonicalName}"`).join(', ')} ---`);
    if (group.blocked) {
      console.log(`  SKIPPED: ${group.blocked}`);
      continue;
    }
    if (group.shortMeaning) console.log(`  short meaning -> ${group.shortMeaning}`);
    console.log(`  rename -> "${group.canonical}" (key "${group.normalizedKey}"), aliases: ${group.aliases.join(' | ') || '(none)'}`);
    console.log(`  links: ${group.repointLinks.length} repointed, ${group.mergeAndDeleteLinks.length} merged into an existing link`);
    console.log(`  pattern cards repointed: ${group.repointStudyItems.length}; patterns soft-deleted: ${group.losers.length}`);
    if (!apply) continue;

    // Losers first lose their key claim only when deleted, so rename the survivor last of the pattern writes.
    for (const link of group.repointLinks) {
      const { error } = await supabase
        .from('sentence_grammar')
        .update({ grammar_pattern_id: group.survivor.id, ...(link.confirmed ? { confirmed_by_learner: true } : {}) })
        .eq('id', link.id);
      check(`repoint link ${link.id}`, error);
    }
    for (const link of group.mergeAndDeleteLinks) {
      const carry = {
        ...(link.surfaceForm ? { surface_form: link.surfaceForm } : {}),
        ...(link.occurrenceExplanation ? { occurrence_explanation: link.occurrenceExplanation } : {}),
        ...(link.confirmed ? { confirmed_by_learner: true } : {}),
      };
      if (Object.keys(carry).length > 0) {
        const { error } = await supabase.from('sentence_grammar').update(carry).eq('id', link.survivorLinkId);
        check(`carry onto link ${link.survivorLinkId}`, error);
      }
      const { error } = await supabase.from('sentence_grammar').update({ deleted_at: now() }).eq('id', link.id);
      check(`delete link ${link.id}`, error);
    }
    for (const item of group.repointStudyItems) {
      const { error } = await supabase.from('study_items').update({ subject_id: item.toPatternId }).eq('id', item.id);
      check(`repoint study item ${item.id}`, error);
    }
    for (const loser of group.losers) {
      const { error } = await supabase.from('grammar_patterns').update({ deleted_at: now() }).eq('id', loser.id);
      check(`delete pattern ${loser.id}`, error);
    }
    const { error } = await supabase
      .from('grammar_patterns')
      .update({
        canonical_name: group.canonical,
        normalized_key: group.normalizedKey,
        aliases: group.aliases,
        ...(group.shortMeaning ? { short_meaning: group.shortMeaning } : {}),
      })
      .eq('id', group.survivor.id);
    check(`rename pattern ${group.survivor.id}`, error);
  }

  console.log(`\n--- no-auto-link (${plan.flags.length}) ---`);
  for (const flag of plan.flags) {
    console.log(`  ${flag.canonicalName}`);
    if (!apply) continue;
    const { error } = await supabase.from('grammar_patterns').update({ family: NO_AUTO_LINK_FAMILY }).eq('id', flag.id);
    check(`flag ${flag.id}`, error);
  }

  console.log(apply ? '\nDone.' : '\nDry run — nothing written. Re-run with --apply to write.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
