import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';

import { endPlannerSessionEarly, getPlannerSession, updatePlannerSessionStep } from '../db/repository';
import type { PlannerSessionStep } from '../domain/types';

/**
 * Executes a recommended session as a sequence (design brief §8): each step
 * deep-links into the existing page that actually does the work (Analyze,
 * Grammar detail, Shadow, Review) rather than reimplementing any of them
 * here — this page only sequences and tracks. Completion is always an
 * explicit action on return, never inferred from navigation alone, so a
 * step the learner merely opened and left is never silently counted as
 * done (see updatePlannerSessionStep's own doc comment).
 */

function targetPath(step: PlannerSessionStep): string | null {
  switch (step.targetKind) {
    case 'continue_book':
      return step.bookId && step.sentenceId
        ? `/books/${step.bookId}/analyze/${step.sentenceId}`
        : null;
    case 'grammar_detail':
      return step.grammarPatternId ? `/grammar/${encodeURIComponent(step.grammarPatternId)}` : null;
    case 'shadow':
      return step.bookId && step.sentenceId
        ? `/books/${step.bookId}/shadow/${step.sentenceId}`
        : null;
    case 'review':
      return step.bookId ? `/books/${step.bookId}/review` : '/review';
    case 'vocabulary_detail':
      return '/vocabulary';
  }
}

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

  const activeIndex = session.steps.findIndex(
    (step) => step.status === 'pending' || step.status === 'active',
  );

  async function handleGo(step: PlannerSessionStep) {
    const path = targetPath(step);
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
          {finished ? 'Session complete' : `Recommended session — ${session.targetMinutes} min`}
        </h2>
        {finished ? (
          <>
            <p className="muted">
              {session.steps.filter((step) => step.status === 'completed').length} of{' '}
              {session.steps.length} activities completed.
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
        {session.steps.map((step, index) => {
          const isActive = index === activeIndex;
          const path = targetPath(step);
          return (
            <li key={step.id} className="list-card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{step.label}</strong>
                <span className="status-pill">{STATUS_LABELS[step.status]}</span>
              </div>
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                {step.reason} · {Math.round(step.estimatedMinutes)} min
              </div>
              {isActive && !finished ? (
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
