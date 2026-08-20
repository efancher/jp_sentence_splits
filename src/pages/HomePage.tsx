import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  computeLearningBalance,
  planRecommendedSession,
  startPlannerSession,
} from '../db/repository';
import type { LearningMode, SessionLength } from '../domain/types';
import { SESSION_LENGTH_MINUTES } from '../lib/sessionPlannerConfig';

/**
 * The Learning Orchestrator's home screen (docs/AI_OVERVIEW.md) — the "what
 * should I do?" landing experience, replacing Books as the index route.
 * One strong recommendation plus a compact rolling-window balance view,
 * deliberately not a dashboard of numbers (design brief §11's "don't
 * clutter" instruction) — direct links to every area stay one tap away
 * below it, so the recommendation guides rather than gates.
 */

const LENGTH_OPTIONS: { value: SessionLength; label: string }[] = [
  { value: 'quick', label: `Quick (${SESSION_LENGTH_MINUTES.quick} min)` },
  { value: 'normal', label: `Normal (${SESSION_LENGTH_MINUTES.normal} min)` },
  { value: 'deep', label: `Deep (${SESSION_LENGTH_MINUTES.deep} min)` },
];

const MODE_LABELS: Record<LearningMode, string> = {
  explore: 'Explore',
  understand: 'Understand',
  practice: 'Practice',
  retain: 'Retain',
};

const MODE_ORDER: LearningMode[] = ['explore', 'understand', 'practice', 'retain'];

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
  const [length, setLength] = useState<SessionLength>('normal');
  const [starting, setStarting] = useState(false);

  const recommendation = useLiveQuery(() => planRecommendedSession(length), [length]);
  const balance = useLiveQuery(() => computeLearningBalance(), []);

  async function handleStart() {
    if (!recommendation || recommendation.steps.length === 0) return;
    setStarting(true);
    try {
      const session = await startPlannerSession(recommendation, length);
      navigate(`/session/${session.id}`);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Continue Learning</h2>
        <div className="row" role="group" aria-label="Session length">
          {LENGTH_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === length ? 'primary' : 'ghost'}
              onClick={() => setLength(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {recommendation === undefined ? (
          <p className="muted">Planning your session…</p>
        ) : (
          <>
            <div className="stack" style={{ gap: '0.25rem' }}>
              {recommendation.explanation.map((line, index) => (
                <p key={index} className="muted" style={{ margin: 0 }}>
                  {line}
                </p>
              ))}
            </div>

            {recommendation.steps.length === 0 ? (
              <p className="muted">
                Nothing to recommend right now — try Quick/Normal/Deep, or use one of the areas
                below directly.
              </p>
            ) : (
              <ol className="stack" style={{ margin: 0, paddingLeft: '1.25rem' }}>
                {recommendation.steps.map((step) => (
                  <li key={step.id}>
                    <strong>{step.label}</strong> — {Math.round(step.estimatedMinutes)} min
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {step.reason}
                    </div>
                  </li>
                ))}
              </ol>
            )}

            <button
              type="button"
              className="primary"
              disabled={starting || recommendation.steps.length === 0}
              onClick={handleStart}
            >
              {starting ? 'Starting…' : 'Start Session'}
            </button>
          </>
        )}
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
