import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { updateSettings } from '../src/db/repository';
import { GAMES } from '../src/games/registry';
import { createId } from '../src/lib/ids';
import { HOMOPHONE_HUNT_GAME_ID } from '../src/lib/homophoneHunt';
import { ODD_EAR_OUT_GAME_ID } from '../src/lib/oddEarOut';
import { SPEAKER_MATCH_GAME_ID } from '../src/lib/speakerMatch';

/**
 * "Pause pitch accent" (2026-09-28, settings.pitchAccentPaused) hides the
 * three pitch-based /play games with a reason rather than the usual
 * "not enough data" message, since the pool isn't actually thin — the
 * learner just asked for pitch accent to be left to shadowing for now.
 */
describe('pitch-based games respect settings.pitchAccentPaused', () => {
  beforeEach(() => {
    resetDbForTests(`game-registry-pitch-pause-${createId('db')}`);
  });

  const pitchGameIds = [ODD_EAR_OUT_GAME_ID, HOMOPHONE_HUNT_GAME_ID, SPEAKER_MATCH_GAME_ID];

  it('reports zero eligible with a pausedReason for each pitch game once paused, and reports normally once unpaused', async () => {
    for (const id of pitchGameIds) {
      const game = GAMES.find((entry) => entry.id === id);
      expect(game).toBeDefined();
      const beforePause = await game!.loadPools();
      expect(beforePause.pausedReason).toBeUndefined();
    }

    await updateSettings({ pitchAccentPaused: true });

    for (const id of pitchGameIds) {
      const game = GAMES.find((entry) => entry.id === id);
      const paused = await game!.loadPools();
      expect(paused.eligible).toBe(0);
      expect(paused.pausedReason).toMatch(/pitch accent is paused/i);
    }

    await updateSettings({ pitchAccentPaused: false });

    for (const id of pitchGameIds) {
      const game = GAMES.find((entry) => entry.id === id);
      const unpaused = await game!.loadPools();
      expect(unpaused.pausedReason).toBeUndefined();
    }
  });

  it('leaves non-pitch games unaffected by the pause', async () => {
    await updateSettings({ pitchAccentPaused: true });
    const wordDetective = GAMES.find((entry) => entry.title === 'Word Detective');
    expect(wordDetective).toBeDefined();
    const pools = await wordDetective!.loadPools();
    expect(pools.pausedReason).toBeUndefined();
  });
});
