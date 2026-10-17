import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaybackCoordinator } from '../src/lib/recording';

afterEach(() => vi.useRealTimers());
describe('native listen–repeat playback', () => {
  function setup() {
    const audio = document.createElement('audio');
    audio.play = vi.fn().mockResolvedValue(undefined);
    audio.pause = vi.fn();
    const player = new PlaybackCoordinator();
    const onPhase = vi.fn();
    return { audio, player, onPhase };
  }
  it('plays once without entering the response gap', async () => {
    const { audio, player, onPhase } = setup();
    const done = player.rehearse(audio, { startMs: 300, endMs: 800 }, { playbackRate: 0.8, repeat: false, gapMs: 1000, onPhase });
    expect(audio.currentTime).toBe(0.3);
    expect(audio.preservesPitch).toBe(true);
    audio.currentTime = 0.81;
    audio.dispatchEvent(new Event('timeupdate'));
    await done;
    expect(audio.pause).toHaveBeenCalled();
    expect(onPhase.mock.calls).toEqual([['listen']]);
  });
  it('waits the requested gap, repeats, and stops immediately during playback', async () => {
    vi.useFakeTimers();
    const { audio, player, onPhase } = setup();
    const done = player.rehearse(audio, { startMs: 0, endMs: 1000 }, { playbackRate: 1, repeat: true, gapMs: 1500, onPhase });
    audio.dispatchEvent(new Event('ended'));
    await vi.advanceTimersByTimeAsync(1499);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(onPhase).toHaveBeenLastCalledWith('repeat');
    await vi.advanceTimersByTimeAsync(1);
    expect(audio.play).toHaveBeenCalledTimes(2);
    player.cancel();
    await done;
    expect(audio.pause).toHaveBeenCalled();
  });
  it('cancels the response gap without leaving a timer or restarting', async () => {
    vi.useFakeTimers();
    const { audio, player, onPhase } = setup();
    const done = player.rehearse(audio, { startMs: 0, endMs: 1000 }, { playbackRate: 1, repeat: true, gapMs: 1500, onPhase });
    audio.dispatchEvent(new Event('ended'));
    await vi.advanceTimersByTimeAsync(0);
    player.cancel();
    await done;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });
});
