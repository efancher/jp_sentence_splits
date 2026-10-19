import { describe, expect, it } from 'vitest';
import { createActiveTimer } from '../src/lib/activeTimer';

describe('createActiveTimer', () => {
  it('measures plain elapsed time', () => {
    const timer = createActiveTimer(true, 1000);
    expect(timer.elapsed(4500)).toBe(3500);
  });

  it('excludes completed and ongoing hidden periods', () => {
    const timer = createActiveTimer(true, 0);
    timer.setVisible(false, 2000);
    timer.setVisible(true, 5000); // 3s hidden
    timer.setVisible(false, 6000);
    expect(timer.elapsed(10000)).toBe(10000 - 3000 - 4000);
  });

  it('ignores repeated visibility states', () => {
    const timer = createActiveTimer(true, 0);
    timer.setVisible(false, 1000);
    timer.setVisible(false, 3000);
    timer.setVisible(true, 4000);
    timer.setVisible(true, 6000);
    expect(timer.elapsed(8000)).toBe(8000 - 3000);
  });

  it('reset starts a new card and keeps a still-hidden page hidden', () => {
    const timer = createActiveTimer(true, 0);
    timer.setVisible(false, 1000);
    timer.reset(5000);
    expect(timer.elapsed(7000)).toBe(0);
    timer.setVisible(true, 8000);
    expect(timer.elapsed(9000)).toBe(1000);
  });
});
