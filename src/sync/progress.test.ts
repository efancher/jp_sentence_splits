import { beforeEach, describe, expect, it } from 'vitest';

import {
  beginSyncCycle,
  endSyncCycle,
  getSyncProgress,
  notePullPage,
  notePushed,
  resetSyncProgressForTests,
  setPushPlan,
  setSyncStage,
} from './progress';

beforeEach(() => resetSyncProgressForTests());

describe('sync progress', () => {
  it('tracks stages, counters and a last-cycle summary', () => {
    beginSyncCycle(1000);
    setSyncStage('push', 1000);
    setPushPlan(3);
    notePushed(2, 'study_items');
    notePushed(1, 'reviews');
    setSyncStage('pull', 1500);
    notePullPage(100, 4);
    notePullPage(20, 0);
    expect(getSyncProgress()).toMatchObject({ running: true, stage: 'pull', pushDone: 3, pullEvents: 120, pullPages: 2, pullSkipped: 4 });
    endSyncCycle(true, 4000);
    const progress = getSyncProgress();
    expect(progress.running).toBe(false);
    expect(progress.lastCycle).toMatchObject({ ok: true, totalMs: 3000, pushed: 3, pulledEvents: 120 });
    expect(progress.lastCycle?.stageMs).toMatchObject({ push: 500, pull: 2500 });
  });

  it('a new cycle resets counters but keeps the previous summary', () => {
    beginSyncCycle(0);
    endSyncCycle(false, 10);
    beginSyncCycle(20);
    expect(getSyncProgress().pushDone).toBe(0);
    expect(getSyncProgress().lastCycle?.ok).toBe(false);
  });
});
