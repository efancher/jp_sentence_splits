import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';

import {
  countAttemptsForSentences,
  endPlannerSessionEarly,
  getPlannerSession,
  getSessionRecap,
  updatePlannerSessionStep,
} from '../db/repository';
import type { PlannerSessionStep, SessionBucket } from '../domain/types';
import { sessionStepTargetPath, shadowAttemptSummary } from '../lib/sessionPlanner';
import type { SessionRecap } from '../lib/sessionRecap';

/**
 * Executes a recommended session (design brief §8): each step deep-links
 * into the existing page that actually does the work (Analyze, Vocabulary,
 * Grammar detail, Shadow, Review) rather than reimplementing any of them
 * here — this page only sequences and tracks. The list is priority-ordered,
 * but every pending/active step gets its own Go/Complete/Skip so the
 * learner can knock out an easy one now and save the rest for later,
 * rather than being forced through in order — SessionBar's "current step"
 * shortcut still always means the oldest unsettled one. A step is settled
 * only by an explicit action — Complete/Skip here or in SessionBar,
 * ReviewPage's target-count auto-advance, or endPlannerSessionEarly. Doing
 * the underlying work in place (confirming vocabulary, marking a sentence
 * complete) does not settle its step (2026-08-27); the step is a day-plan
 * checklist item the learner ticks off, layered over the real progress.
 */

const STATUS_LABELS: Record<PlannerSessionStep['status'], string> = {
  pending: 'Up next',
  active: 'In progress',
  completed: 'Done',
  skipped: 'Skipped',
  replaced: 'Replaced',
};

const RECAP_BUCKET_LABELS: Record<SessionBucket, string> = {
  glossing: 'New sentences',
  grammar: 'Grammar',
  shadowing: 'Shadowing',
  review: 'Review',
};

/** Post-session summary — what today's work actually moved (`getSessionRecap`). */
function SessionRecapPanel({ recap }: { recap: SessionRecap }) {
  if (recap.isEmpty) return null;
  const { reviews } = recap;
  return (
    <div className="stack" style={{ gap: '0.35rem' }}>
      <strong>Today you</strong>
      <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
        {recap.byBucket.map((line) => (
          <li key={line.bucket}>
            {RECAP_BUCKET_LABELS[line.bucket]}: {line.completed}/{line.total} done
          </li>
        ))}
        {reviews.graded > 0 ? (
          <li>
            graded {reviews.graded} review{reviews.graded === 1 ? '' : 's'}
            {reviews.accuracy !== null
              ? ` — ${Math.round(reviews.accuracy * 100)}% recalled`
              : ''}
          </li>
        ) : null}
        {recap.newWords > 0 ? (
          <li>
            started {recap.newWords} new word{recap.newWords === 1 ? '' : 's'}
          </li>
        ) : null}
        {recap.grammarNoticed > 0 ? (
          <li>
            noticed grammar in {recap.grammarNoticed} sentence
            {recap.grammarNoticed === 1 ? '' : 's'}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

export function SessionRunnerPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const session = useLiveQuery(
    () => (sessionId ? getPlannerSession(sessionId) : undefined),
    [sessionId],
  );

  const shadowSentenceIds = (session?.steps ?? [])
    .filter((step) => step.bucket === 'shadowing' && step.sentenceId)
    .map((step) => step.sentenceId!);
  // Recompute each shadow step's subtitle from the live attempt count — the
  // planner freezes `step.reason` at plan time, so without this the card keeps
  // saying "Not shadowed yet" after the learner has recorded attempts.
  const shadowAttemptCounts = useLiveQuery(
    () => countAttemptsForSentences(shadowSentenceIds),
    [shadowSentenceIds.join(',')],
  );

  const sessionFinished = !!session && session.status !== 'in_progress';
  const recap = useLiveQuery(
    () => (sessionFinished && session ? getSessionRecap(session) : Promise.resolve(undefined)),
    [sessionFinished, session?.id, session?.updatedAt],
  );

  if (!sessionId) return null;
  if (!session) return <p className="muted">Loading…</p>;

  function stepReason(step: PlannerSessionStep): string {
    if (step.bucket === 'shadowing' && step.sentenceId && shadowAttemptCounts) {
      return shadowAttemptSummary(shadowAttemptCounts.get(step.sentenceId) ?? 0);
    }
    return step.reason;
  }

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
            {recap ? <SessionRecapPanel recap={recap} /> : null}
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
                {stepReason(step)} · {Math.round(step.estimatedMinutes)} min
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
