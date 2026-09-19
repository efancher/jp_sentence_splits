/**
 * "Daily practice" recommendations — a small fixed set of do-this-today
 * targets shown beside the planned session (`DailyPracticePanel`). Deliberately
 * *not* session steps and not SRS: they don't take minutes from the planner's
 * buckets, don't touch FSRS, and never settle by hand — progress is counted
 * from logs the activities already write (`pitchDrillAttempts`, `gameRounds`),
 * so doing the work is the only thing that ticks it off. Pure; all data comes
 * in as plain numbers so it is unit-testable without Dexie.
 */

/** Scored words on the pitch-accent drill per day. */
export const DAILY_PITCH_DRILL_TARGET = 5;
/** Rounds of each recommended game per day. */
export const DAILY_GAME_ROUND_TARGET = 1;

export const PITCH_DRILL_PRACTICE_ID = 'pitch-drill';
export const ODD_EAR_OUT_PRACTICE_ID = 'odd-ear-out';

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
  oddEarOut: {
    /** The game can build a round (hub eligibility). Unknown-yet callers pass true. */
    available: boolean;
    roundsToday: number;
  };
  /** The day's rotating extra game, already chosen by `rotatingGameId` and checked playable; omitted when none is. */
  rotatingGame?: { id: string; title: string; roundsToday: number };
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

  if (input.oddEarOut.available) {
    items.push(
      item({
        id: ODD_EAR_OUT_PRACTICE_ID,
        title: 'Odd Ear Out — one round',
        detail: 'Hear four real native words and pick the one with the odd accent shape.',
        done: input.oddEarOut.roundsToday,
        target: DAILY_GAME_ROUND_TARGET,
        unit: 'round',
        path: `/play/${ODD_EAR_OUT_PRACTICE_ID}/auto`,
      }),
    );
  }

  if (input.rotatingGame) {
    const game = input.rotatingGame;
    items.push(
      item({
        id: `game:${game.id}`,
        title: `${game.title} — one round`,
        detail: "Today's rotating game: a short break that still trains a skill.",
        done: game.roundsToday,
        target: DAILY_GAME_ROUND_TARGET,
        unit: 'round',
        path: `/play/${game.id}/auto`,
      }),
    );
  }

  return items;
}

/**
 * Which games to try, in order, for today's rotating slot. Stable within a
 * local calendar day (so the recommendation doesn't change under the learner
 * after they play it) and advancing by one each day. The caller takes the
 * first that is actually playable.
 */
export function rotatingGameOrder(gameIds: readonly string[], now: Date): string[] {
  if (gameIds.length === 0) return [];
  const dayNumber = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
  const start = dayNumber % gameIds.length;
  return gameIds.map((_, offset) => gameIds[(start + offset) % gameIds.length]!);
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
