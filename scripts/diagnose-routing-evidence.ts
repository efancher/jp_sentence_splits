/**
 * Read-only evidence-coverage audit for learned practice routing
 * (docs/ADAPTIVE_SCHEDULING_RESEARCH.md, stage 0). Reports what attempt → help
 * → follow-up evidence exists; it does not estimate any helper's effect.
 *
 * Usage: npm run diagnose:routing-evidence [-- --json] [-- --since=2026-10-02]
 * (default --since is the sentence-led switch date; legacy drills are reported
 * separately under "all time").
 */
import {
  summariseEvents,
  summariseGloss,
  summariseReviewMisses,
  reviewCoverage,
  type EventRow,
  type GlossRow,
  type ReviewRow,
  type StudyItemRow,
} from './lib/routingEvidenceAudit';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const SENTENCE_LED_SINCE = '2026-10-02T00:00:00Z';

const str = (v: unknown): string => String(v);
const optStr = (v: unknown): string | null => (v == null ? null : String(v));
const optNum = (v: unknown): number | null => (v == null ? null : Number(v));
const optBool = (v: unknown): boolean | null => (v == null ? null : Boolean(v));

function pct(share: number): string {
  return `${(share * 100).toFixed(0)}%`;
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const sinceArg = argv.find((a) => a.startsWith('--since='))?.slice('--since='.length);
  const since = sinceArg ? new Date(sinceArg).toISOString() : SENTENCE_LED_SINCE;

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const [reviews, studyItems, gloss, events] = await Promise.all([
    fetchAll<ReviewRow>(
      supabase,
      'reviews',
      'id,study_item_id,timestamp,rating,assistance,elapsed_ms,predicted_retrievability,context_sentence_id,presentation,meaning_choice,comprehension_check_correct,source',
      user.id,
      (r) => ({
        id: str(r.id),
        studyItemId: str(r.study_item_id),
        timestamp: str(r.timestamp),
        rating: str(r.rating),
        assistance: (r.assistance as string[] | null) ?? null,
        elapsedMs: optNum(r.elapsed_ms),
        predictedRetrievability: optNum(r.predicted_retrievability),
        contextSentenceId: optStr(r.context_sentence_id),
        presentation: r.presentation ?? null,
        meaningChoice: r.meaning_choice ?? null,
        comprehensionCheckCorrect: optBool(r.comprehension_check_correct),
        source: optStr(r.source),
      }),
    ),
    fetchAll<StudyItemRow>(
      supabase,
      'study_items',
      'id,subject_type,subject_id,activity_type',
      user.id,
      (r) => ({
        id: str(r.id),
        subjectType: str(r.subject_type),
        subjectId: str(r.subject_id),
        activityType: str(r.activity_type),
      }),
    ),
    fetchAll<GlossRow>(
      supabase,
      'gloss_decisions',
      'id,timestamp,visit_id,sentence_id,skill,subskill,rule_key,level_shown,first_correct,reference_confidence,hint_max_step,explanation_opened,blocker,vocab_helped,translation_level,outcome,retry_of_id,help_sequence,content_revision,first_response_ms',
      user.id,
      (r) => ({
        id: str(r.id),
        timestamp: str(r.timestamp),
        visitId: str(r.visit_id),
        sentenceId: str(r.sentence_id),
        skill: str(r.skill),
        subskill: str(r.subskill),
        ruleKey: str(r.rule_key),
        levelShown: Number(r.level_shown),
        firstCorrect: optBool(r.first_correct),
        referenceConfidence: str(r.reference_confidence),
        hintMaxStep: Number(r.hint_max_step ?? 0),
        explanationOpened: Boolean(r.explanation_opened),
        blocker: optStr(r.blocker),
        vocabHelped: Boolean(r.vocab_helped),
        translationLevel: Number(r.translation_level ?? 0),
        outcome: str(r.outcome),
        retryOfId: optStr(r.retry_of_id),
        helpSequence: (r.help_sequence as string[] | null) ?? null,
        contentRevision: optStr(r.content_revision),
        firstResponseMs: optNum(r.first_response_ms),
      }),
    ),
    fetchAll<EventRow>(
      supabase,
      'sentence_learning_events',
      'id,timestamp,visit_id,action,sentence_id,target_key,support,outcome,help_level,exposed_sentence_id',
      user.id,
      (r) => ({
        id: str(r.id),
        timestamp: str(r.timestamp),
        visitId: str(r.visit_id),
        action: str(r.action),
        sentenceId: str(r.sentence_id),
        targetKey: optStr(r.target_key),
        support: optStr(r.support),
        outcome: optStr(r.outcome),
        helpLevel: optStr(r.help_level),
        exposedSentenceId: optStr(r.exposed_sentence_id),
      }),
    ),
  ]);

  const items = new Map(studyItems.map((i) => [i.id, i]));
  const recentReviews = reviews.filter((r) => r.timestamp >= since);
  const recentGloss = gloss.filter((g) => g.timestamp >= since);
  const recentEvents = events.filter((e) => e.timestamp >= since);

  const report = {
    since,
    counts: { reviews: reviews.length, glossDecisions: gloss.length, learningEvents: events.length },
    reviewCoverageAllTime: reviewCoverage(reviews, items),
    reviewCoverageSince: reviewCoverage(reviews, items, since),
    reviewMissesAllTime: summariseReviewMisses(reviews, items),
    reviewMissesSince: summariseReviewMisses(recentReviews, items),
    glossAllTime: summariseGloss(gloss),
    glossSince: summariseGloss(recentGloss),
    eventsAllTime: summariseEvents(events),
    eventsSince: summariseEvents(recentEvents),
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Routing evidence audit (read-only). "Since" = ${since}\n`);
  console.log('Rows:', report.counts);

  for (const [label, rows] of [
    ['all time', report.reviewCoverageAllTime],
    [`since ${since.slice(0, 10)}`, report.reviewCoverageSince],
  ] as const) {
    console.log(`\n== Review field coverage by activity (${label}) ==`);
    for (const row of rows) {
      const fields = Object.entries(row.fields).map(([k, v]) => `${k} ${pct(v)}`).join(', ');
      console.log(`${row.group} (${row.rows}): ${fields}`);
    }
  }

  for (const [label, rows] of [
    ['all time', report.reviewMissesAllTime],
    [`since ${since.slice(0, 10)}`, report.reviewMissesSince],
  ] as const) {
    console.log(`\n== Review misses ("again") and later reviews of the same item (${label}) ==`);
    for (const row of rows) console.log(JSON.stringify(row));
  }

  console.log('\n== Gloss decisions (since) ==');
  console.log(JSON.stringify(report.glossSince, null, 2));
  console.log('\n== Gloss decisions (all time) ==');
  console.log(JSON.stringify(report.glossAllTime, null, 2));
  console.log('\n== Sentence learning events (since) ==');
  console.log(JSON.stringify(report.eventsSince, null, 2));
  console.log('\n== Sentence learning events (all time) ==');
  console.log(JSON.stringify(report.eventsAllTime, null, 2));

  console.log(
    '\nCaveats: follow-ups are opportunities, not reconstructed episodes; a later review/attempt' +
      ' may follow other exposures, and gloss follow-ups require a different visit. Review misses' +
      ' use rating "again" only. Reviews of paused card types are legacy; judge current' +
      ' sentence-led coverage from the "since" sections.',
  );
}

void main();
