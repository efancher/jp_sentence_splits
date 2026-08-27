import { useLiveQuery } from 'dexie-react-hooks';
import { useLocation } from 'react-router-dom';

import { getActiveInProgressPlannerSession } from '../db/repository';
import type { PlannerSession, PlannerSessionStep } from '../domain/types';
import { sessionStepTargetPath } from '../lib/sessionPlanner';

export interface ActiveSession {
  session: PlannerSession;
  /** First pending-or-active step — the session's "oldest unfinished" pointer, used for the "Resume" shortcut and progress framing. */
  currentStep: PlannerSessionStep | undefined;
  /**
   * The pending/active step whose target page is the route currently on
   * screen, if any — so the SessionBar can act on *what the learner is
   * looking at* rather than blindly on `currentStep`. Undefined when the
   * learner has navigated somewhere that isn't a session step's page (a book
   * list, an already-settled step, an unrelated sentence).
   */
  routeStep: PlannerSessionStep | undefined;
}

/** Global "is a session running right now" query — powers SessionBar so any page can offer a way back without a session id in its own route. */
export function useActiveSession(): ActiveSession | undefined {
  const session = useLiveQuery(() => getActiveInProgressPlannerSession(), []);
  const { pathname } = useLocation();
  if (!session) return undefined;
  const isOpen = (step: PlannerSessionStep) =>
    step.status === 'pending' || step.status === 'active';
  const currentStep = session.steps.find(isOpen);
  const routeStep = session.steps.find(
    (step) => isOpen(step) && sessionStepTargetPath(step) === pathname,
  );
  return { session, currentStep, routeStep };
}
