import { useLiveQuery } from 'dexie-react-hooks';

import { getActiveInProgressPlannerSession } from '../db/repository';
import type { PlannerSession, PlannerSessionStep } from '../domain/types';

export interface ActiveSession {
  session: PlannerSession;
  /** Same "first pending or active" rule SessionRunnerPage uses to pick its highlighted step. */
  currentStep: PlannerSessionStep | undefined;
}

/** Global "is a session running right now" query — powers SessionBar so any page can offer a way back without a session id in its own route. */
export function useActiveSession(): ActiveSession | undefined {
  const session = useLiveQuery(() => getActiveInProgressPlannerSession(), []);
  if (!session) return undefined;
  const currentStep = session.steps.find(
    (step) => step.status === 'pending' || step.status === 'active',
  );
  return { session, currentStep };
}
