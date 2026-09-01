import { useLiveQuery } from 'dexie-react-hooks';

import { getProgressReport } from '../db/repository';
import type { TrendDirection } from '../lib/pronunciationProfile';
import type { WeekBucket } from '../lib/progressReport';

/**
 * "How am I doing" progress screen (docs/ROADMAP.md — "Retention /
 * progress-over-time view"). Read-only; every number is recomputed from
 * evidence already logged (`Review` rows, `StudyItem` FSRS state, shadowing
 * analysis summaries) by `getProgressReport` / `buildProgressReport`, so
 * there's nothing to seed. Deliberately minimal — a few interpretable
 * counts, an FSRS pass-rate, and an 8-week activity trend reusing the
 * existing `.progress-bar` meter rather than a charting dependency.
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

export function ProgressPage() {
  const report = useLiveQuery(() => getProgressReport(), []);

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
        </>
      ) : null}
    </div>
  );
}
