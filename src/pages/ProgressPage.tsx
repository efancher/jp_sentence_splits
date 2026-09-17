import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import {
  countNewVocabularyCardBacklog,
  getBlindSpots,
  getErrorMix,
  getFsrsConfidenceSnapshot,
  getGateFunnelSnapshot,
  getLeechList,
  getProgressReport,
  getSelfRatingCalibration,
  getSkillCoverage,
  getStepUsefulness,
} from '../db/repository';
import type { ErrorCategory } from '../lib/errorMix';
import type { TrendDirection } from '../lib/pronunciationProfile';
import type { WeekBucket } from '../lib/progressReport';
import { buildVelocityReport } from '../lib/velocity';

/**
 * "How am I doing" progress screen (docs/ROADMAP.md — "Retention /
 * progress-over-time view", plus the 2026-09 "Blind spots" and "What to
 * work on" panels). Read-only; every number is recomputed from evidence
 * already logged (`Review` rows, `StudyItem` FSRS state, shadowing analysis
 * summaries, tokenizer suggestions) by the repository, so there's nothing
 * to seed. Deliberately minimal — interpretable counts, an FSRS pass-rate,
 * an 8-week activity trend, and two actionable "what next" panels; the
 * `.progress-bar` meter is reused rather than a charting dependency.
 */

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function trendLabel(trend: TrendDirection): string {
  switch (trend) {
    case 'improving':
      return 'improving';
    case 'worsening':
      return 'getting worse';
    case 'steady':
      return 'holding steady';
    case 'insufficient_data':
      return 'not enough data yet';
  }
}

function trendMark(trend: TrendDirection): string {
  switch (trend) {
    case 'improving':
      return ' ↓ easing';
    case 'worsening':
      return ' ↑ growing';
    case 'steady':
      return ' · steady';
    case 'insufficient_data':
      return '';
  }
}

function StatRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span>
        {label}
        {hint ? (
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            {' '}
            · {hint}
          </span>
        ) : null}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function WeekBars({
  weeks,
  value,
  format,
}: {
  weeks: WeekBucket[];
  value: (week: WeekBucket) => number;
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...weeks.map(value));
  return (
    <div className="stack" style={{ gap: '0.35rem' }}>
      {weeks.map((week) => {
        const n = value(week);
        return (
          <div key={week.weekStart} className="stack" style={{ gap: '0.15rem' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                {new Date(`${week.weekStart}T00:00:00.000Z`).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                {format ? format(n) : n}
              </span>
            </div>
            <div className="progress-bar">
              <span style={{ width: `${Math.round((n / max) * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ErrorCategoryRow({ category }: { category: ErrorCategory }) {
  const share = Math.round(category.shareOfClassified * 100);
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span>
        {category.label}
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          {' '}
          · {category.count} {category.count === 1 ? 'miss' : 'misses'} ({share}%)
          {trendMark(category.trend)}
        </span>
      </span>
      {category.route ? (
        <Link to={category.route} className="muted" style={{ fontSize: '0.85rem' }}>
          {category.nextAction} →
        </Link>
      ) : (
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {category.nextAction}
        </span>
      )}
    </div>
  );
}

const ERROR_WINDOWS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 0, label: 'All time' },
];

const TARGET_KIND_LABELS: Record<string, string> = {
  continue_book: 'Analyze',
  grammar_detail: 'Grammar detail',
  grammar_noticing: 'Notice grammar',
  shadow: 'Shadow',
  review: 'Due review',
  vocabulary_detail: 'Vocabulary detail',
  vocabulary_review: 'Confirm vocabulary',
};

export function ProgressPage() {
  const [errorWindow, setErrorWindow] = useState(30);
  const report = useLiveQuery(() => getProgressReport(), []);
  const blindSpots = useLiveQuery(() => getBlindSpots(), []);
  const errorMix = useLiveQuery(() => getErrorMix({ windowDays: errorWindow }), [errorWindow]);
  const calibration = useLiveQuery(() => getSelfRatingCalibration(), []);
  const skillCoverage = useLiveQuery(() => getSkillCoverage(), []);
  const fsrsConfidence = useLiveQuery(() => getFsrsConfidenceSnapshot(), []);
  const stepUsefulness = useLiveQuery(() => getStepUsefulness(), []);
  const gateFunnel = useLiveQuery(() => getGateFunnelSnapshot(), []);
  const newCardBacklog = useLiveQuery(() => countNewVocabularyCardBacklog(), []);
  const leechList = useLiveQuery(() => getLeechList(), []);
  const velocity =
    report && newCardBacklog !== undefined
      ? buildVelocityReport(newCardBacklog, report.weeks)
      : undefined;

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Progress</h2>
        {report === undefined ? (
          <p className="muted">Loading…</p>
        ) : !report.hasData ? (
          <p className="muted">
            Nothing to report yet — do some reviews and shadowing and this screen fills in from the
            evidence they log.
          </p>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Recomputed from your review history and shadowing analyses — nothing here is stored or
            editable.
          </p>
        )}
      </section>

      {report?.hasData || errorMix?.hasData ? (
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h3 style={{ margin: 0 }}>What to work on</h3>
          <div className="row" style={{ gap: '0.25rem' }}>
            {ERROR_WINDOWS.map((window) => (
              <button
                key={window.days}
                type="button"
                className={errorWindow === window.days ? 'primary' : undefined}
                aria-pressed={errorWindow === window.days}
                style={{ fontSize: '0.8rem', padding: '0.15rem 0.5rem' }}
                onClick={() => setErrorWindow(window.days)}
              >
                {window.label}
              </button>
            ))}
          </div>
        </div>
        {errorMix === undefined ? (
          <p className="muted">Loading…</p>
        ) : !errorMix.hasData ? (
          <p className="muted">
            No graded mistakes to break down yet — this fills in as you miss cards that check a
            typed answer (readings, conjugations, contrastive pairs, pitch).
          </p>
        ) : (
          <>
            {errorMix.categories.length > 0 ? (
              errorMix.categories.map((category) => (
                <ErrorCategoryRow key={category.key} category={category} />
              ))
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                No auto-classified mistakes in this window.
              </p>
            )}
            {errorMix.unclassifiedAgainCount > 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                {errorMix.unclassifiedAgainCount} more misses on self-rated cards
                (comprehension, listening) — no breakdown available for those.
              </p>
            ) : null}
            {errorMix.pronunciation ? (
              <div className="stack" style={{ gap: '0.25rem', marginTop: '0.35rem' }}>
                <div
                  className="row"
                  style={{ justifyContent: 'space-between', alignItems: 'baseline' }}
                >
                  <span>
                    Pronunciation
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      {' '}
                      · from shadowing
                      {errorMix.pronunciation.topFocusLabel
                        ? `: ${errorMix.pronunciation.topFocusLabel.toLowerCase()}`
                        : ''}
                      {errorMix.pronunciation.topFocusTrend
                        ? trendMark(errorMix.pronunciation.topFocusTrend)
                        : ''}
                    </span>
                  </span>
                  <Link to="/pronunciation" className="muted" style={{ fontSize: '0.85rem' }}>
                    Profile →
                  </Link>
                </div>
                {errorMix.pronunciation.weakWords.length > 0 ? (
                  <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                    Words to drill:{' '}
                    {errorMix.pronunciation.weakWords
                      .map((word) => `${word.surfaceForm} (${word.attemptCount}×)`)
                      .join(', ')}{' '}
                    · <Link to="/pitch-accent">pitch-accent drill →</Link>
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </section>
      ) : null}

      {(blindSpots && (blindSpots.vocab.length > 0 || blindSpots.grammar.worthLearningNowCount > 0)) ||
      report?.hasData ? (
      <section className="panel stack">
        <h3 style={{ margin: 0 }}>Blind spots</h3>
        {blindSpots === undefined ? (
          <p className="muted">Loading…</p>
        ) : blindSpots.vocab.length === 0 && blindSpots.grammar.worthLearningNowCount === 0 ? (
          <p className="muted">
            Nothing unaccounted for — every recurring word and pattern in the books you've worked
            is confirmed.
          </p>
        ) : (
          <>
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
              Recurring in books you've read, never confirmed or tracked.
            </p>
            {blindSpots.vocab.map((word) => (
              <div
                key={`${word.expression} ${word.reading}`}
                className="row"
                style={{ justifyContent: 'space-between', alignItems: 'baseline' }}
              >
                <span>
                  {word.expression}
                  {word.reading && word.reading !== word.expression ? `【${word.reading}】` : ''}
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    {' '}
                    · {word.sentenceCount} sentences
                    {word.bookCount > 1 ? ` · ${word.bookCount} books` : ''}
                    {word.english ? ` · ${word.english}` : ''}
                  </span>
                </span>
                <Link
                  to={`/books/${word.exampleBookId}/vocabulary/${word.exampleSentenceId}`}
                  className="muted"
                  style={{ fontSize: '0.85rem' }}
                >
                  Confirm →
                </Link>
              </div>
            ))}
            {blindSpots.grammar.worthLearningNowCount > 0 ? (
              <div
                className="row"
                style={{ justifyContent: 'space-between', alignItems: 'baseline' }}
              >
                <span>
                  {blindSpots.grammar.worthLearningNowCount} grammar{' '}
                  {blindSpots.grammar.worthLearningNowCount === 1 ? 'pattern' : 'patterns'} worth
                  learning now
                  {blindSpots.grammar.topNames.length > 0 ? (
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      {' '}
                      · {blindSpots.grammar.topNames.join(', ')}
                    </span>
                  ) : null}
                </span>
                <Link to="/grammar" className="muted" style={{ fontSize: '0.85rem' }}>
                  Grammar →
                </Link>
              </div>
            ) : null}
          </>
        )}
      </section>
      ) : null}

      {report && report.hasData ? (
        <>
          <section className="panel stack">
            <h3 style={{ margin: 0 }}>Vocabulary</h3>
            <StatRow label="Tracked words" value={String(report.vocabulary.tracked)} />
            <StatRow
              label="Proficient"
              value={String(report.vocabulary.proficient)}
              hint="recalled at least once, now on a real schedule"
            />
            <StatRow
              label="Mature"
              value={String(report.vocabulary.mature)}
              hint="long interval on every activity"
            />
            <StatRow
              label="First recalled recently"
              value={String(report.vocabulary.learnedInWindow)}
              hint={`last ${report.retention.windowDays} days`}
            />
          </section>

          <section className="panel stack">
            <h3 style={{ margin: 0 }}>Retention</h3>
            <StatRow
              label={`Recall success (last ${report.retention.windowDays} days)`}
              value={formatPercent(report.retention.windowRate)}
              hint={`${report.retention.recalled} of ${report.retention.scheduledReviews} scheduled reviews`}
            />
            <StatRow
              label="Recall success (all time)"
              value={formatPercent(report.retention.allTimeRate)}
            />
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
              Share of scheduled reviews you passed (any rating other than "Again"). Natural
              encounters aren't counted.
            </p>
          </section>

          <section className="panel stack">
            <h3 style={{ margin: 0 }}>Grammar</h3>
            <StatRow label="Tracked patterns" value={String(report.grammar.tracked)} />
            <StatRow
              label="Recognized"
              value={String(report.grammar.recognized)}
              hint="comprehension card proficient"
            />
          </section>

          <section className="panel stack">
            <h3 style={{ margin: 0 }}>Shadowing</h3>
            {report.shadowing.attemptsAnalyzed === 0 ? (
              <p className="muted">No analyzed attempts yet.</p>
            ) : (
              <>
                <StatRow
                  label="Analyzed attempts"
                  value={String(report.shadowing.attemptsAnalyzed)}
                  hint={`${report.shadowing.sentencesPracticed} sentences`}
                />
                <StatRow label="Timing trend" value={trendLabel(report.shadowing.timingTrend)} />
                <StatRow label="Pitch trend" value={trendLabel(report.shadowing.pitchTrend)} />
              </>
            )}
          </section>

          <section className="panel stack">
            <h3 style={{ margin: 0 }}>Reviews per week</h3>
            <WeekBars weeks={report.weeks} value={(week) => week.reviews} />
          </section>

          <section className="panel stack">
            <h3 style={{ margin: 0 }}>Words learned (cumulative)</h3>
            <WeekBars
              weeks={report.weeks}
              value={(week) => week.cumulativeWordsLearned}
            />
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
              Running total of words you've recalled for the first time, by week.
            </p>
          </section>

          <section className="panel stack">
            <h3 style={{ margin: 0 }}>New-card backlog</h3>
            {velocity === undefined ? (
              <p className="muted">Loading…</p>
            ) : velocity.backlogSize === 0 ? (
              <p className="muted">No backlog — every confirmed word is already in the SRS.</p>
            ) : (
              <>
                <StatRow label="Confirmed, not yet in the SRS" value={String(velocity.backlogSize)} />
                <StatRow
                  label="Recent pace"
                  value={
                    velocity.weeklyWordsLearnedRate === null
                      ? '—'
                      : `${velocity.weeklyWordsLearnedRate.toFixed(1)} words/week`
                  }
                />
                <StatRow
                  label="At this rate"
                  value={
                    velocity.weeksToClearBacklog === null
                      ? 'no estimate yet'
                      : `~${velocity.weeksToClearBacklog} week${velocity.weeksToClearBacklog === 1 ? '' : 's'} to clear`
                  }
                />
                <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                  Based on the last {Math.max(0, report.weeks.length - 1)} complete week
                  {report.weeks.length - 1 === 1 ? '' : 's'} of newly-recalled words. Raise "New
                  cards per review session" in Settings to go faster.
                </p>
              </>
            )}
          </section>
        </>
      ) : null}

      <section className="panel stack">
        <h3 style={{ margin: 0 }}>Self-rating check</h3>
        {calibration === undefined ? (
          <p className="muted">Loading…</p>
        ) : !calibration.hasData ? (
          <p className="muted">
            Not enough reviews yet on both self-rated cards (reading in context, listening, word
            listening, reading retrieval, cloze) and graded ones (reading production, conjugation,
            grammar, pitch accent, contrastive pairs) to compare.
          </p>
        ) : (
          <>
            <StatRow
              label="Self-rated pass rate"
              value={formatPercent(calibration.selfRated.passRate)}
              hint={`${calibration.selfRated.reviewCount} reviews`}
            />
            <StatRow
              label="Graded pass rate"
              value={formatPercent(calibration.graded.passRate)}
              hint={`${calibration.graded.reviewCount} reviews`}
            />
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
              {calibration.gap === null
                ? 'Not enough data on both sides to compare.'
                : calibration.gap > 0.05
                  ? `Self-rated cards pass ${Math.round(calibration.gap * 100)} points more often than graded ones — worth rating a bit more strictly.`
                  : calibration.gap < -0.05
                    ? `Self-rated cards pass ${Math.round(Math.abs(calibration.gap) * 100)} points less often than graded ones — you may be rating yourself harder than your actual recall.`
                    : 'Self-rated and graded cards pass at about the same rate — self-rating looks honest.'}
            </p>
            {calibration.selfRatedByActivityType
              .filter((row) => row.reviewCount > 0)
              .map((row) => (
                <StatRow
                  key={row.activityType}
                  label={row.activityType}
                  value={formatPercent(row.passRate)}
                  hint={`${row.reviewCount} reviews`}
                />
              ))}
          </>
        )}
      </section>

      <section className="panel stack">
        <h3 style={{ margin: 0 }}>Skill coverage</h3>
        {skillCoverage === undefined ? (
          <p className="muted">Loading…</p>
        ) : !skillCoverage.hasData ? (
          <p className="muted">No recognized vocabulary yet.</p>
        ) : (
          <>
            <StatRow label="Words recognized" value={String(skillCoverage.recognized)} />
            {skillCoverage.rungs.map((rung) => (
              <StatRow
                key={rung.label}
                label={rung.label}
                value={formatPercent(rung.share)}
                hint={`${rung.count} of ${skillCoverage.recognized}`}
              />
            ))}
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
              Of the words you can recognize, how many have also reached the other skills
              (producing the reading, pitch, being heard in a sentence) — the biggest gap is
              where a bucket is trailing.
            </p>
          </>
        )}
      </section>

      <section className="panel stack">
        <h3 style={{ margin: 0 }}>FSRS confidence</h3>
        {fsrsConfidence === undefined ? (
          <p className="muted">Loading…</p>
        ) : !fsrsConfidence.hasData ? (
          <p className="muted">No active study items yet.</p>
        ) : (
          <>
            <StatRow
              label="Average predicted recall right now"
              value={formatPercent(fsrsConfidence.averageRetrievability)}
              hint={`${fsrsConfidence.activeCount} active items`}
            />
            {fsrsConfidence.buckets.map((bucket) => (
              <StatRow key={bucket.label} label={bucket.label} value={String(bucket.count)} />
            ))}
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
              FSRS's own live estimate of how likely you are to recall each active item right
              now — a lot piled in the low buckets means reviews are lagging behind schedule;
              everything at 95%+ means you're reviewing more than the schedule needs.
            </p>
          </>
        )}
      </section>

      <section className="panel stack">
        <h3 style={{ margin: 0 }}>Step usefulness</h3>
        {stepUsefulness === undefined ? (
          <p className="muted">Loading…</p>
        ) : !stepUsefulness.hasData ? (
          <p className="muted">No settled session steps yet.</p>
        ) : (
          <>
            {stepUsefulness.rows.map((row) => (
              <StatRow
                key={row.targetKind}
                label={`${TARGET_KIND_LABELS[row.targetKind] ?? row.targetKind} — skip rate`}
                value={formatPercent(row.skipRate)}
                hint={`${row.completed} done, ${row.skipped} skipped`}
              />
            ))}
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
              Last {stepUsefulness.windowDays} days — which planner step kinds actually get done
              vs. quietly skipped every time.
            </p>
          </>
        )}
      </section>

      <section className="panel stack">
        <h3 style={{ margin: 0 }}>What's stuck</h3>
        {gateFunnel === undefined ? (
          <p className="muted">Loading…</p>
        ) : !gateFunnel.hasData ? (
          <p className="muted">Nothing to check yet.</p>
        ) : (
          <>
            <StatRow
              label="Confirmed, words never reviewed"
              value={String(gateFunnel.continueBookBlocked)}
              hint="waiting on Analyze"
            />
            <StatRow
              label="Shadow-ready except pitch"
              value={String(gateFunnel.shadowBlockedOnPitch)}
              hint="words known, pitch not yet"
            />
            <StatRow
              label="Listening-ready except pitch"
              value={String(gateFunnel.listeningBlockedOnPitch)}
              hint="words heard, pitch not yet"
            />
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
              Sentences that clear every other requirement for a step and are blocked on
              specifically the one named — not a general readiness count.
            </p>
          </>
        )}
      </section>

      <section className="panel stack">
        <h3 style={{ margin: 0 }}>Leech list</h3>
        {leechList === undefined ? (
          <p className="muted">Loading…</p>
        ) : !leechList.hasData ? (
          <p className="muted">
            No real leeches yet — nothing has failed after being on a genuine review schedule.
          </p>
        ) : (
          <>
            {leechList.rows.map((row) => (
              <div
                key={row.studyItemId}
                className="row"
                style={{ justifyContent: 'space-between', alignItems: 'baseline' }}
              >
                <span>
                  <Link to={`/study-items/${row.studyItemId}`} className="jp">
                    {row.subjectLabel}
                  </Link>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    {' '}
                    · {row.activityType} · {row.lapses} lapse{row.lapses === 1 ? '' : 's'} ·{' '}
                    {row.reasonLabel}
                  </span>
                </span>
                {row.route ? (
                  <Link to={row.route} className="muted" style={{ fontSize: '0.85rem' }}>
                    {row.nextAction} →
                  </Link>
                ) : (
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    {row.nextAction}
                  </span>
                )}
              </div>
            ))}
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
              Ranked by real FSRS lapses plus recent miss rate — never a separate drill, just
              where to focus next.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
