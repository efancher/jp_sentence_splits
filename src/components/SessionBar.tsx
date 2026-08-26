import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { settleSessionStep } from '../db/repository';
import { useActiveSession } from '../hooks/useActiveSession';
import { sessionStepTargetPath } from '../lib/sessionPlanner';

/**
 * Persistent "you're mid-session" affordance, mounted once in AppShell so it
 * shows on every route a session step deep-links into (Analyze, Review,
 * Shadow, Grammar detail, ...) without those pages needing to know a session
 * exists. Lets the learner get back to the session list, or close out the
 * current step, from wherever a page's own navigation (e.g. "confirm and
 * next") happened to carry them — that gap, not the review/practice pages
 * themselves, was the actual bug.
 *
 * Trimmed to a single "Mark complete" action (2026-08-26 follow-up — Skip
 * and a standalone "Session" button were found cluttered/hard to hold in
 * mind mid-session, mirroring the earlier single-control preference for
 * Record/Stop). Marking complete auto-advances straight to the next step's
 * page, same as before. The full step list — where Skip still lives,
 * unchanged — stays one tap away via the plain "Session · X/Y" link below,
 * just not as a prominent button.
 */
export function SessionBar() {
  const active = useActiveSession();
  const [updating, setUpdating] = useState(false);
  const navigate = useNavigate();

  if (!active) return null;
  const { session, currentStep } = active;

  const settledCount = session.steps.filter(
    (step) => step.status === 'completed' || step.status === 'skipped' || step.status === 'replaced',
  ).length;

  async function markComplete() {
    if (!currentStep || updating) return;
    setUpdating(true);
    try {
      const result = await settleSessionStep(session.id, currentStep.id, 'completed');
      const nextPath = result?.nextStep ? sessionStepTargetPath(result.nextStep) : null;
      if (nextPath) navigate(nextPath);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="session-bar">
      <div className="session-bar-info">
        <Link to={`/session/${session.id}`} className="muted">
          Session · {settledCount}/{session.steps.length}
        </Link>
        {currentStep ? <strong>{currentStep.label}</strong> : null}
      </div>
      <div className="row session-bar-actions">
        {currentStep ? (
          <button type="button" disabled={updating} onClick={() => void markComplete()}>
            Mark complete
          </button>
        ) : null}
      </div>
    </div>
  );
}
