/**
 * "Try again later" for shadowing: the learner pushes a sentence out of the
 * shadow-candidate pool for a few days. Pure helpers; persistence lives in
 * repository.ts (`snoozeShadowSentence`, `settings.shadowSnoozes`).
 */

export interface ShadowSnoozeOption {
  days: number;
  label: string;
}

export const SHADOW_SNOOZE_OPTIONS: readonly ShadowSnoozeOption[] = [
  { days: 1, label: 'Tomorrow' },
  { days: 5, label: '5 days' },
  { days: 14, label: '2 weeks' },
];

/** Start of the local day `days` days after `now` — "tomorrow" means from tomorrow morning, not 24h from now. */
export function shadowSnoozeUntil(now: Date, days: number): string {
  const until = new Date(now);
  until.setHours(0, 0, 0, 0);
  until.setDate(until.getDate() + days);
  return until.toISOString();
}

/** Sentence ids whose snooze is still in force at `now`. */
export function activeShadowSnoozeIds(
  snoozes: Record<string, string> | undefined,
  now: Date,
): Set<string> {
  const nowIso = now.toISOString();
  return new Set(
    Object.entries(snoozes ?? {})
      .filter(([, until]) => until > nowIso)
      .map(([id]) => id),
  );
}
