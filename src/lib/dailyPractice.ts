/**
 * "Daily practice" recommendations — a small fixed set of do-this-today
 * targets shown beside the planned session (`DailyPracticePanel`). Deliberately
 * *not* session steps and not SRS: they don't take minutes from the planner's
 * buckets, don't touch FSRS, and never settle by hand — progress is counted
 * from the log the drill already writes (`pitchDrillAttempts`),
 * so doing the work is the only thing that ticks it off. Pure; all data comes
 * in as plain numbers so it is unit-testable without Dexie.
 */

/** Scored words on the pitch-accent drill per day. */
export const DAILY_PITCH_DRILL_TARGET = 5;

export const PITCH_DRILL_PRACTICE_ID = 'pitch-drill';

export interface DailyPracticeItem {
  id: string;
  title: string;
  detail: string;
  done: number;
  target: number;
  /** Singular noun for the counter ("word", "round"). */
  unit: string;
  complete: boolean;
  path: string;
}

export interface DailyPracticeInput {
  /** `settings.quietMode` — can't speak aloud, so the recording drill is left out. */
  quietMode: boolean;
  pitchDrill: {
    /** Any word the single-words drill could serve. */
    available: boolean;
    /** Words whose pitch card was missed twice in a row (`getPitchAccentFocusWords`). */
    focusWordCount: number;
    takesToday: number;
  };
}

function item(
  base: Omit<DailyPracticeItem, 'complete'>,
): DailyPracticeItem {
  return { ...base, complete: base.done >= base.target };
}

export function buildDailyPractice(input: DailyPracticeInput): DailyPracticeItem[] {
  const items: DailyPracticeItem[] = [];

  if (!input.quietMode && input.pitchDrill.available) {
    const { focusWordCount, takesToday } = input.pitchDrill;
    items.push(
      item({
        id: PITCH_DRILL_PRACTICE_ID,
        title: `Pitch drill — say ${DAILY_PITCH_DRILL_TARGET} words`,
        detail:
          focusWordCount > 0
            ? `Start with the ${focusWordCount} word${focusWordCount === 1 ? '' : 's'} you missed in review, then any others.`
            : 'Single words: say each one and get its pitch checked.',
        done: takesToday,
        target: DAILY_PITCH_DRILL_TARGET,
        unit: 'word',
        path: '/pitch-accent?mode=word',
      }),
    );
  }

  return items;
}

export function dailyPracticeProgress(items: readonly DailyPracticeItem[]): {
  done: number;
  total: number;
} {
  return { done: items.filter((entry) => entry.complete).length, total: items.length };
}

/** Local midnight of `now`, as an ISO timestamp — the start of "today" for the logs' `timestamp` fields. */
export function startOfLocalDayIso(now: Date): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}
