import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { updatePlannerSessionStep } from '../db/repository';
import { useActiveSession } from '../hooks/useActiveSession';
import { sessionStepTargetPath } from '../lib/sessionPlanner';

/**
 * Persistent "you're mid-session" affordance, mounted once in AppShell so it
 * shows on every route a session step deep-links into (Analyze, Review,
 * Shadow, Grammar detail, ...) without those pages needing to know a session
 * exists. Lets the learner get back to the session list, or close out the
 * current step, from wherever a page's own navigation (e.g. "confirm and
 * next") happened to carry them — that gap, not the review/practice pages
 * themselves, was the actual bug. AppShell only mounts this when it should
 * actually be visible (there's an active session, and we're not already on
 * its own /session/:id page), so no visibility check is needed here.
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

  async function settleCurrentStep(status: 'completed' | 'skipped') {
    if (!currentStep || updating) return;
    setUpdating(true);
    try {
      await updatePlannerSessionStep(session.id, currentStep.id, { status });

      // currentStep is always the first pending/active step, so once it's
      // settled the next one to run is the first pending/active step after it.
      const currentIndex = session.steps.findIndex((step) => step.id === currentStep.id);
      const nextStep = session.steps
        .slice(currentIndex + 1)
        .find((step) => step.status === 'pending' || step.status === 'active');
      const nextPath = nextStep ? sessionStepTargetPath(nextStep) : null;
      if (nextStep && nextPath) {
        await updatePlannerSessionStep(session.id, nextStep.id, { status: 'active' });
        navigate(nextPath);
      }
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="session-bar">
      <div className="session-bar-info">
        <span className="muted">
          Session · {settledCount}/{session.steps.length}
        </span>
        {currentStep ? <strong>{currentStep.label}</strong> : null}
      </div>
      <div className="row session-bar-actions">
        {currentStep ? (
          <>
            <button type="button" disabled={updating} onClick={() => void settleCurrentStep('completed')}>
              Mark complete
            </button>
            <button
              type="button"
              className="ghost"
              disabled={updating}
              onClick={() => void settleCurrentStep('skipped')}
            >
              Skip
            </button>
          </>
        ) : null}
        <Link to={`/session/${session.id}`}>
          <button type="button" className="ghost">
            Session
          </button>
        </Link>
      </div>
    </div>
  );
}
