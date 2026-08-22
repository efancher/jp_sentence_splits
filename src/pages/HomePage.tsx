import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { readSettings } from '../db/database';
import { addMinutesToTodaySession, computeLearningBalance, getTodayPlannerSession } from '../db/repository';
import type { LearningMode, PlannerStepStatus } from '../domain/types';
import { DEFAULT_DAILY_BUDGET_MINUTES, TOP_UP_INCREMENTS_MINUTES } from '../lib/sessionPlannerConfig';

/**
 * The Learning Orchestrator's home screen (docs/AI_OVERVIEW.md) — the "what
 * should I do?" landing experience, replacing Books as the index route. One
 * growing **daily** list (`PlannerSession`, keyed one-per-local-day) rather
 * than a fixed-length Quick/Normal/Deep sitting, since real usage is a
 * roughly hour-a-day budget picked up in small pieces throughout the day —
 * "Start"/"+more time" are both just `addMinutesToTodaySession`, so the
 * first tap of the day creates the session and every later tap tops it up.
 * A compact rolling-window balance view sits below it, and direct links to
 * every area stay one tap away, so the recommendation guides without
 * gating (design brief §11's "don't clutter" instruction, unchanged from
 * the original version of this page).
 */

const MODE_LABELS: Record<LearningMode, string> = {
  explore: 'Explore',
  understand: 'Understand',
  practice: 'Practice',
  retain: 'Retain',
};

const MODE_ORDER: LearningMode[] = ['explore', 'understand', 'practice', 'retain'];

const STEP_STATUS_LABELS: Record<PlannerStepStatus, string> = {
  pending: 'Up next',
  active: 'In progress',
  completed: 'Done',
  skipped: 'Skipped',
  replaced: 'Replaced',
};

const SHORTCUTS = [
  { to: '/books', label: 'Books' },
  { to: '/grammar', label: 'Grammar' },
  { to: '/review', label: 'Review' },
  { to: '/vocabulary', label: 'Words' },
  { to: '/search', label: 'Library / Search' },
] as const;

function formatDaysSince(days: number | null): string {
  if (days === null) return 'not yet';
  if (days < 1) return 'today';
  const rounded = Math.round(days);
  return `${rounded}d ago`;
}

export function HomePage() {
  const navigate = useNavigate();
  const [addingMinutes, setAddingMinutes] = useState<number | null>(null);

  const session = useLiveQuery(() => getTodayPlannerSession(), []);
  const balance = useLiveQuery(() => computeLearningBalance(), []);
  const settings = useLiveQuery(() => readSettings(), []);
  const dailyBudgetMinutes = settings?.dailyBudgetMinutes ?? DEFAULT_DAILY_BUDGET_MINUTES;

  async function handleAdd(minutes: number) {
    setAddingMinutes(minutes);
    try {
      await addMinutesToTodaySession(minutes);
    } finally {
      setAddingMinutes(null);
    }
  }

  const hasUnsettledStep = session?.steps.some(
    (step) => step.status === 'pending' || step.status === 'active',
  );

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Today</h2>

        {session === undefined ? (
          <p className="muted">Loading…</p>
        ) : !session ? (
          <p className="muted">Nothing planned yet today — add some time to get a recommendation.</p>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>
              {session.targetMinutes} min planned today
            </p>
            <div className="stack" style={{ gap: '0.25rem' }}>
              {session.explanation.map((line, index) => (
                <p key={index} className="muted" style={{ margin: 0 }}>
                  {line}
                </p>
              ))}
            </div>

            {session.steps.length > 0 ? (
              <ol className="stack" style={{ margin: 0, paddingLeft: '1.25rem' }}>
                {session.steps.map((step) => (
                  <li key={step.id}>
                    <strong>{step.label}</strong> — {Math.round(step.estimatedMinutes)} min
                    <span className="status-pill" style={{ marginLeft: '0.5rem' }}>
                      {STEP_STATUS_LABELS[step.status]}
                    </span>
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {step.reason}
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}

            {hasUnsettledStep ? (
              <button type="button" className="primary" onClick={() => navigate(`/session/${session.id}`)}>
                Continue today's session
              </button>
            ) : (
              <p className="muted">All done for now — add more time below whenever you have it.</p>
            )}
          </>
        )}

        <div className="row" role="group" aria-label="Add time to today's session">
          <button
            type="button"
            className="primary"
            disabled={addingMinutes !== null}
            onClick={() => handleAdd(dailyBudgetMinutes)}
          >
            {addingMinutes === dailyBudgetMinutes
              ? 'Adding…'
              : session
                ? `+${dailyBudgetMinutes} min`
                : `Start (${dailyBudgetMinutes} min)`}
          </button>
          {TOP_UP_INCREMENTS_MINUTES.map((minutes) => (
            <button
              key={minutes}
              type="button"
              className="ghost"
              disabled={addingMinutes !== null}
              onClick={() => handleAdd(minutes)}
            >
              {addingMinutes === minutes ? 'Adding…' : `+${minutes} min`}
            </button>
          ))}
        </div>
      </section>

      <section className="panel stack">
        <h3 style={{ margin: 0 }}>Learning balance (last 14 days)</h3>
        {balance === undefined ? (
          <p className="muted">Loading…</p>
        ) : (
          MODE_ORDER.map((mode) => {
            const entry = balance.find((item) => item.mode === mode);
            const fillPercent = entry ? Math.round((1 - entry.neglectScore) * 100) : 0;
            return (
              <div key={mode} className="stack" style={{ gap: '0.25rem' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{MODE_LABELS[mode]}</span>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>
                    {formatDaysSince(entry?.daysSinceLast ?? null)}
                  </span>
                </div>
                <div className="progress-bar">
                  <span style={{ width: `${fillPercent}%` }} />
                </div>
              </div>
            );
          })
        )}
      </section>

      <section className="panel">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {SHORTCUTS.map((shortcut) => (
            <Link key={shortcut.to} to={shortcut.to} className="list-card" style={{ flex: '1 0 auto' }}>
              {shortcut.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
