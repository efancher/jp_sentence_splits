import type { PlannerSession, SentenceLearningEvent } from '../domain/types';
import { sentencesReadyToRevisit } from './sentenceJourney';

export interface SentenceLessonReport {
  windowDays: number;
  planned: { lessons: number; completed: number; skipped: number; pending: number };
  /** Days with a plan in the window that held no lesson step at all. */
  planDaysWithoutLessons: number;
  planDays: number;
  outcomes: {
    sentencesWalked: number;
    gistChecks: number;
    gistHad: number;
    sentencesSaidIndependently: number;
    writtenAttempts: number;
    spokenAttempts: number;
    transferAttempts: number;
    transferNewMeaning: number;
    rechecks: number;
    recheckNewMeaning: number;
  };
  quality: { contentReports: number; practicedTargets: number; reportedSentences: number };
  backlog: { readyToRevisit: number; oldestDays: number | null };
  hasData: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Joined view of lesson supply (plans), learner outcomes and content defects — derived, nothing stored. */
export function buildSentenceLessonReport(
  events: SentenceLearningEvent[],
  sessions: PlannerSession[],
  now: Date = new Date(),
  windowDays = 14,
): SentenceLessonReport {
  const since = now.getTime() - windowDays * DAY_MS;
  const inWindow = (iso: string) => new Date(iso).getTime() >= since;
  const recentSessions = sessions.filter((session) => inWindow(session.createdAt));
  const lessonSteps = recentSessions.flatMap((session) =>
    session.steps.filter((step) => step.targetKind === 'sentence_learning'),
  );
  const recent = events.filter((event) => inWindow(event.timestamp));
  const walked = new Set(
    recent.filter((event) => event.action === 'walkthrough_completed').map((event) => event.sentenceId),
  );
  const gists = recent.filter((event) => event.action === 'gist_check');
  const attempts = recent.filter((event) => event.action === 'expression_attempt');
  const independent = new Set(
    attempts
      .filter((event) => event.outcome === 'got_it' && (event.scaffold ?? 'none') === 'none')
      .map((event) => event.sentenceId),
  );
  const reports = recent.filter((event) => event.action === 'content_report');

  const ready = sentencesReadyToRevisit(events, now);
  const firstWalk = new Map<string, number>();
  for (const event of events) {
    if (event.action !== 'walkthrough_completed') continue;
    const at = new Date(event.timestamp).getTime();
    const seen = firstWalk.get(event.sentenceId);
    if (seen === undefined || at < seen) firstWalk.set(event.sentenceId, at);
  }
  const ages = ready.map((id) => (now.getTime() - (firstWalk.get(id) ?? now.getTime())) / DAY_MS);

  return {
    windowDays,
    planned: {
      lessons: lessonSteps.length,
      completed: lessonSteps.filter((step) => step.status === 'completed').length,
      skipped: lessonSteps.filter((step) => step.status === 'skipped').length,
      pending: lessonSteps.filter((step) => step.status === 'pending' || step.status === 'active').length,
    },
    planDays: recentSessions.length,
    planDaysWithoutLessons: recentSessions.filter(
      (session) => !session.steps.some((step) => step.targetKind === 'sentence_learning'),
    ).length,
    outcomes: {
      sentencesWalked: walked.size,
      gistChecks: gists.length,
      gistHad: gists.filter((event) => event.outcome === 'got_it').length,
      sentencesSaidIndependently: independent.size,
      writtenAttempts: attempts.filter((event) => event.modality !== 'spoken').length,
      spokenAttempts: attempts.filter((event) => event.modality === 'spoken').length,
      transferAttempts: recent.filter((event) => event.action === 'transfer_attempt').length,
      rechecks: recent.filter((event) => event.action === 'transfer_recheck').length,
      recheckNewMeaning: recent.filter((event) => event.action === 'transfer_recheck' && event.outcome === 'got_it').length,
      transferNewMeaning: recent.filter((event) => event.action === 'transfer_attempt' && event.outcome === 'got_it').length,
    },
    quality: {
      contentReports: reports.length,
      practicedTargets: recent.filter((event) => event.action === 'target_practice').length,
      reportedSentences: new Set(reports.map((event) => event.sentenceId)).size,
    },
    backlog: { readyToRevisit: ready.length, oldestDays: ages.length ? Math.floor(Math.max(...ages)) : null },
    hasData: events.length > 0 || lessonSteps.length > 0,
  };
}
