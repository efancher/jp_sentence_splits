import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { settleSessionStep } from '../db/repository';
import { useActiveSession } from '../hooks/useActiveSession';
import { sessionStepTargetPath } from '../lib/sessionPlanner';

/**
 * Persistent "you're mid-session" affordance, mounted once in AppShell so it
 * shows on every route a session step deep-links into (Analyze, Review,
 * Shadow, Grammar detail, ...) without those pages needing to know a session
 * exists.
 *
 * The bar acts on *what's on screen*: when the current route is a pending
 * step's page (`routeStep`), it names that step and its "Mark complete"
 * settles exactly it, then auto-advances to the next step's page. When the
 * learner is anywhere else — a settled step they came back to, an unrelated
 * book, a menu — there's nothing to "complete" from here, so the bar instead
 * shows the next unfinished step and a plain "Resume" that just navigates
 * there (no settle). This split is deliberate: the earlier version always
 * settled `currentStep` regardless of the page, so "Mark complete" could
 * quietly finish a step the learner hadn't looked at.
 */
export function SessionBar() {
  const active = useActiveSession();
  const [updating, setUpdating] = useState(false);
  const navigate = useNavigate();

  if (!active) return null;
  const { session, currentStep, routeStep } = active;

  const settledCount = session.steps.filter(
    (step) => step.status === 'completed' || step.status === 'skipped' || step.status === 'replaced',
  ).length;

  async function markComplete() {
    if (!routeStep || updating) return;
    setUpdating(true);
    try {
      const result = await settleSessionStep(session.id, routeStep.id, 'completed');
      const nextPath = result?.nextStep ? sessionStepTargetPath(result.nextStep) : null;
      if (nextPath) navigate(nextPath);
    } finally {
      setUpdating(false);
    }
  }

  function resume() {
    const path = currentStep ? sessionStepTargetPath(currentStep) : null;
    navigate(path ?? `/session/${session.id}`);
  }

  return (
    <div className="session-bar">
      <div className="session-bar-info">
        <Link to={`/session/${session.id}`} className="muted">
          Session · {settledCount}/{session.steps.length}
        </Link>
        {routeStep ? (
          <strong>{routeStep.label}</strong>
        ) : currentStep ? (
          <span className="muted">Next: {currentStep.label}</span>
        ) : null}
      </div>
      <div className="row session-bar-actions">
        {routeStep ? (
          <button type="button" disabled={updating} onClick={() => void markComplete()}>
            Mark complete
          </button>
        ) : currentStep ? (
          <button type="button" onClick={resume}>
            Resume
          </button>
        ) : null}
      </div>
    </div>
  );
}
