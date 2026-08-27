import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { readSettings } from '../db/database';
import {
  addMinutesToTodaySession,
  computeLearningBalance,
  deleteTodayPlannerSession,
  getTodayPlannerSession,
  updateSettings,
} from '../db/repository';
import type { PlannerStepStatus, SessionBucket } from '../domain/types';
import { ALL_SESSION_BUCKETS } from '../lib/sessionPlanner';
import {
  BASELINE_SESSION_ALLOCATION,
  DEFAULT_DAILY_BUDGET_MINUTES,
  TOP_UP_INCREMENTS_MINUTES,
} from '../lib/sessionPlannerConfig';

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
 *
 * The activity split (2026-08-26 follow-up) is set directly here, in a
 * hideable section right before Start/+time, instead of on Settings — user
 * feedback found the earlier Explore/Understand/Practice/Retain abstraction
 * not concrete enough to set percentages against, so it's now framed as
 * four named activities (glossing/grammar/shadowing/review) and this is the
 * only place it's editable.
 */

const SESSION_BUCKET_LABELS: Record<SessionBucket, string> = {
  glossing: 'New sentences (glossing)',
  grammar: 'Grammar',
  shadowing: 'Shadowing',
  review: 'Review',
};

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
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Open by default (2026-08-27 follow-up) — hiding it behind a click meant
  // the split was easy to forget to adjust before starting/topping up.
  const [splitOpen, setSplitOpen] = useState(true);
  // null = follow the saved default (settings.sessionAllocation); set once the
  // learner edits a value here, and persisted back as the new default on add.
  const [customSplit, setCustomSplit] = useState<Record<SessionBucket, number> | null>(null);

  // Sentinel `null` for "loaded, no session today" — useLiveQuery itself
  // returns undefined while loading, so leaving getTodayPlannerSession's own
  // undefined-when-absent result unwrapped would make "just cleared" and
  // "still fetching" indistinguishable (same convention StudyItemDebugPage
  // uses).
  const session = useLiveQuery(async () => (await getTodayPlannerSession()) ?? null, []);
  const balance = useLiveQuery(() => computeLearningBalance(), []);
  const settings = useLiveQuery(() => readSettings(), []);
  const dailyBudgetMinutes = settings?.dailyBudgetMinutes ?? DEFAULT_DAILY_BUDGET_MINUTES;
  const activeSplit = customSplit ?? settings?.sessionAllocation ?? BASELINE_SESSION_ALLOCATION;

  async function handleAdd(minutes: number) {
    setAddingMinutes(minutes);
    try {
      await addMinutesToTodaySession(minutes, new Date(), customSplit ?? undefined);
      if (customSplit) await updateSettings({ sessionAllocation: customSplit });
    } finally {
      setAddingMinutes(null);
    }
  }

  async function handleClear() {
    await deleteTodayPlannerSession(new Date());
    setConfirmingClear(false);
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

            {confirmingClear ? (
              <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: '0.85rem' }}>
                  Clear today's plan and start over? Completed work (reviews, analysis, vocab
                  confirmations) isn't affected.
                </span>
                <button type="button" className="danger" onClick={handleClear}>
                  Yes, clear it
                </button>
                <button type="button" className="ghost" onClick={() => setConfirmingClear(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className="ghost" onClick={() => setConfirmingClear(true)}>
                Clear today's session
              </button>
            )}
          </>
        )}

        <details
          open={splitOpen}
          onToggle={(event) => setSplitOpen((event.target as HTMLDetailsElement).open)}
        >
          <summary>Customize split</summary>
          <div className="stack" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
            {ALL_SESSION_BUCKETS.map((bucket) => (
              <label key={bucket}>
                {SESSION_BUCKET_LABELS[bucket]}
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(activeSplit[bucket] * 100)}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    if (Number.isNaN(parsed) || parsed < 0) return;
                    setCustomSplit({ ...activeSplit, [bucket]: parsed / 100 });
                  }}
                />
              </label>
            ))}
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              Split of the added time across these four activities, before the
              orchestrator nudges it toward whatever you've neglected lately.
              Shares are relative, so they don't strictly need to add up to
              100%. Changing this and adding time saves it as your new
              default.
            </p>
            {customSplit ? (
              <button type="button" className="ghost" onClick={() => setCustomSplit(null)}>
                Reset to saved default
              </button>
            ) : null}
          </div>
        </details>

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
          ALL_SESSION_BUCKETS.map((bucket) => {
            const entry = balance.find((item) => item.bucket === bucket);
            const fillPercent = entry ? Math.round((1 - entry.neglectScore) * 100) : 0;
            return (
              <div key={bucket} className="stack" style={{ gap: '0.25rem' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{SESSION_BUCKET_LABELS[bucket]}</span>
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
