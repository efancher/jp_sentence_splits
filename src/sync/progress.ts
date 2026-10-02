/** Live, in-memory view of what the sync engine is doing; read by the Account & sync monitor. */

export interface SyncCycleSummary {
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  stageMs: Record<string, number>;
  pushed: number;
  pulledEvents: number;
  ok: boolean;
}

export interface SyncProgress {
  running: boolean;
  stage: string;
  cycleStartedAt: number | null;
  stageStartedAt: number | null;
  /** Completed stage durations within the running cycle. */
  stageMs: Record<string, number>;
  pushTotal: number;
  pushDone: number;
  /** Entity currently being pushed. */
  pushEntity: string | null;
  pullPages: number;
  pullEvents: number;
  pullSkipped: number;
  audioTotal: number;
  audioDone: number;
  lastCycle: SyncCycleSummary | null;
  /** Bumped on every change so useSyncExternalStore sees a new snapshot. */
  rev: number;
}

const initial = (): SyncProgress => ({
  running: false,
  stage: 'idle',
  cycleStartedAt: null,
  stageStartedAt: null,
  stageMs: {},
  pushTotal: 0,
  pushDone: 0,
  pushEntity: null,
  pullPages: 0,
  pullEvents: 0,
  pullSkipped: 0,
  audioTotal: 0,
  audioDone: 0,
  lastCycle: null,
  rev: 0,
});

let state: SyncProgress = initial();
const listeners = new Set<() => void>();

function commit(patch: Partial<SyncProgress>): void {
  state = { ...state, ...patch, rev: state.rev + 1 };
  for (const listener of listeners) listener();
}

export function subscribeSyncProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSyncProgress(): SyncProgress {
  return state;
}

export function beginSyncCycle(now = Date.now()): void {
  commit({
    ...initial(),
    lastCycle: state.lastCycle,
    audioTotal: state.audioTotal,
    audioDone: state.audioDone,
    rev: state.rev,
    running: true,
    stage: 'starting',
    cycleStartedAt: now,
    stageStartedAt: now,
  });
}

export function setSyncStage(stage: string, now = Date.now()): void {
  const stageMs = { ...state.stageMs };
  if (state.running && state.stageStartedAt != null && state.stage !== stage) {
    stageMs[state.stage] = (stageMs[state.stage] ?? 0) + (now - state.stageStartedAt);
  }
  commit({ stage, stageStartedAt: now, stageMs });
}

export function setPushPlan(total: number): void {
  commit({ pushTotal: total, pushDone: 0 });
}

export function notePushed(count: number, entity: string): void {
  commit({ pushDone: state.pushDone + count, pushEntity: entity });
}

export function notePullPage(events: number, skipped: number): void {
  commit({
    pullPages: state.pullPages + 1,
    pullEvents: state.pullEvents + events,
    pullSkipped: state.pullSkipped + skipped,
  });
}

export function setAudioProgress(total: number, done: number): void {
  commit({ audioTotal: total, audioDone: done });
}

export function endSyncCycle(ok: boolean, now = Date.now()): void {
  const startedAt = state.cycleStartedAt ?? now;
  const stageMs = { ...state.stageMs };
  if (state.stageStartedAt != null && state.stage !== 'idle') {
    stageMs[state.stage] = (stageMs[state.stage] ?? 0) + (now - state.stageStartedAt);
  }
  commit({
    running: false,
    stage: 'idle',
    cycleStartedAt: null,
    stageStartedAt: null,
    stageMs,
    pushEntity: null,
    lastCycle: {
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(now).toISOString(),
      totalMs: now - startedAt,
      stageMs,
      pushed: state.pushDone,
      pulledEvents: state.pullEvents,
      ok,
    },
  });
}

export function resetSyncProgressForTests(): void {
  state = initial();
  listeners.clear();
}
