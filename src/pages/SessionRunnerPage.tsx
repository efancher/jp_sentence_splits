import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';

import { endPlannerSessionEarly, getPlannerSession, updatePlannerSessionStep } from '../db/repository';
import type { PlannerSessionStep } from '../domain/types';
import { sessionStepTargetPath } from '../lib/sessionPlanner';

/**
 * Executes a recommended session (design brief §8): each step deep-links
 * into the existing page that actually does the work (Analyze, Vocabulary,
 * Grammar detail, Shadow, Review) rather than reimplementing any of them
 * here — this page only sequences and tracks. The list is priority-ordered,
 * but every pending/active step gets its own Go/Complete/Skip so the
 * learner can knock out an easy one now and save the rest for later,
 * rather than being forced through in order — SessionBar's "current step"
 * shortcut still always means the oldest unsettled one. A step is never
 * silently counted as done just because the learner opened and left it —
 * it's settled either by an explicit action here/in SessionBar, or by real
 * completion of the underlying work (see updatePlannerSessionStep's and
 * autoCompleteSessionSteps's own doc comments in repository.ts).
 */

const STATUS_LABELS: Record<PlannerSessionStep['status'], string> = {
  pending: 'Up next',
  active: 'In progress',
  completed: 'Done',
  skipped: 'Skipped',
  replaced: 'Replaced',
};

export function SessionRunnerPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const session = useLiveQuery(
    () => (sessionId ? getPlannerSession(sessionId) : undefined),
    [sessionId],
  );

  if (!sessionId) return null;
  if (!session) return <p className="muted">Loading…</p>;

  async function handleGo(step: PlannerSessionStep) {
    const path = sessionStepTargetPath(step);
    if (!path) return;
    await updatePlannerSessionStep(sessionId!, step.id, { status: 'active' });
    navigate(path);
  }

  async function handleComplete(step: PlannerSessionStep) {
    await updatePlannerSessionStep(sessionId!, step.id, { status: 'completed' });
  }

  async function handleSkip(step: PlannerSessionStep) {
    await updatePlannerSessionStep(sessionId!, step.id, { status: 'skipped' });
  }

  async function handleEndEarly() {
    await endPlannerSessionEarly(sessionId!);
  }

  const finished = session.status !== 'in_progress';

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>
          {finished ? "Today's session — all settled for now" : `Today's session — ${session.targetMinutes} min planned`}
        </h2>
        {finished ? (
          <>
            <p className="muted">
              {session.steps.filter((step) => step.status === 'completed').length} of{' '}
              {session.steps.length} activities completed. Add more time from Home whenever you have it.
            </p>
            <button type="button" className="primary" onClick={() => navigate('/')}>
              Back to Home
            </button>
          </>
        ) : (
          <button type="button" className="ghost" onClick={handleEndEarly}>
            End session early
          </button>
        )}
      </section>

      <ol className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {session.steps.map((step) => {
          const isUnsettled = step.status === 'pending' || step.status === 'active';
          const path = sessionStepTargetPath(step);
          return (
            <li key={step.id} className="list-card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{step.label}</strong>
                <span className="status-pill">{STATUS_LABELS[step.status]}</span>
              </div>
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                {step.reason} · {Math.round(step.estimatedMinutes)} min
              </div>
              {isUnsettled && !finished ? (
                <div className="row" style={{ marginTop: '0.5rem' }}>
                  <button type="button" className="primary" disabled={!path} onClick={() => handleGo(step)}>
                    {step.status === 'active' ? 'Continue' : 'Go'}
                  </button>
                  {step.status === 'active' ? (
                    <button type="button" onClick={() => handleComplete(step)}>
                      Mark complete
                    </button>
                  ) : null}
                  <button type="button" className="ghost" onClick={() => handleSkip(step)}>
                    Skip
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
