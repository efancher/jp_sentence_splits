import { useNavigate } from 'react-router-dom';

import type { PlannerSessionStep } from '../domain/types';
import { sessionStepTargetPath } from '../lib/sessionPlanner';

/**
 * Shared "I just finished a piece of session work — move me along" navigation
 * for every activity page that can settle a session step in place (vocabulary
 * confirm, analyze "Mark complete", practice status). Hand it the next step the
 * repository reports after settling (`confirmSentenceVocabulary`,
 * `setBookSentenceStatus` → `autoCompleteSessionSteps`) and it deep-links into
 * that step's page. No-ops when there isn't one — no active session, the item
 * wasn't part of the session, or the session just finished — so callers can
 * always call it unconditionally and keep their own non-session fallback
 * (e.g. "next sentence in this book") in the `else`.
 */
export function useSessionAdvance(): (nextStep: PlannerSessionStep | undefined) => boolean {
  const navigate = useNavigate();
  return (nextStep) => {
    if (!nextStep) return false;
    const target = sessionStepTargetPath(nextStep);
    if (!target) return false;
    navigate(target);
    return true;
  };
}
