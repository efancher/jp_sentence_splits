import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { loadGameBreakCandidates } from '../src/games/gameBreaks';
import { createId } from '../src/lib/ids';

describe('loadGameBreakCandidates', () => {
  beforeEach(() => {
    resetDbForTests(`game-breaks-${createId('db')}`);
  });

  it('offers no games when no game has enough material to fill a round', async () => {
    await expect(loadGameBreakCandidates()).resolves.toEqual([]);
  });
});
