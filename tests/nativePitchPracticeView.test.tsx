import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativePitchPractice } from '../src/components/NativePitchPractice';
import type { SentenceAudio } from '../src/domain/types';

const mocks = vi.hoisted(() => ({ alignment: vi.fn(), pitch: vi.fn(), cancel: vi.fn(), rehearse: vi.fn() }));
vi.mock('../src/lib/alignmentCache', () => ({ loadOrComputeAlignment: mocks.alignment }));
vi.mock('../src/lib/referencePitchCache', () => ({ loadOrComputeReferencePitch: mocks.pitch }));
vi.mock('../src/lib/nativeAudio', () => ({ nativeAudioController: { stop: vi.fn() } }));
vi.mock('../src/lib/recording', () => ({
  PLAYBACK_SPEEDS: [0.8, 1],
  PlaybackCoordinator: class {
    cancel = mocks.cancel;
    rehearse = mocks.rehearse;
  },
}));
const audio = { id: 'a', blob: new Blob(['audio']), durationMs: 2000 } as SentenceAudio;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.alignment.mockResolvedValue({ durationSeconds: 2, words: [
    { text: 'あ', start: 0.2, end: 0.4, phones: [{ text: 'a', start: 0.2, end: 0.4 }] },
    { text: 'い', start: 0.8, end: 1, phones: [{ text: 'i', start: 0.8, end: 1 }] },
  ] });
  mocks.pitch.mockResolvedValue({ durationSeconds: 2, frames: [0.25, 0.3, 0.85, 0.9].map(timeSeconds => ({ timeSeconds, voiced: true, relativeSemitones: 2 })) });
  mocks.rehearse.mockImplementation((_audio, _range, options) => {
    options.onPhase('listen');
    return new Promise(() => {});
  });
});
async function open() {
  await userEvent.click(screen.getByRole('button', { name: 'Prepare with the native recording' }));
  await screen.findByRole('button', { name: 'Whole sentence' });
}
describe('native preparation panel', () => {
  it('opens without an attempt, plays the selected chunk, and cancels on close', async () => {
    const onStart = vi.fn();
    render(<NativePitchPractice audio={audio} japanese="あい" disabled={false} onStart={onStart} />);
    expect(mocks.alignment).not.toHaveBeenCalled();
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'い', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Listen → repeat' }));
    expect(onStart).toHaveBeenCalledOnce();
    expect(mocks.rehearse.mock.calls[0]![1]).toEqual({ startMs: 760, endMs: 1060 });
    expect(mocks.rehearse.mock.calls[0]![2]).toMatchObject({ repeat: true, playbackRate: 1, gapMs: 1000 });
    expect(screen.queryByText('H', { exact: true })).toBeNull();
    const count = mocks.cancel.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Close pitch practice' }));
    expect(mocks.cancel.mock.calls.length).toBeGreaterThan(count);
  });
  it('stops when a recording starts and disables playback', async () => {
    const onStart = vi.fn();
    const { rerender } = render(<NativePitchPractice audio={audio} japanese="あい" disabled={false} onStart={onStart} />);
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Listen', exact: true }));
    rerender(<NativePitchPractice audio={audio} japanese="あい" disabled onStart={onStart} />);
    expect(screen.getByRole('button', { name: 'Listen', exact: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled();
  });
  it('stops on another media player and on changing chunks', async () => {
    render(<NativePitchPractice audio={audio} japanese="あい" disabled={false} onStart={() => {}} />);
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Listen', exact: true }));
    fireEvent(document, new Event('play'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled());
    await userEvent.click(screen.getByRole('button', { name: 'Listen', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'あ', exact: true }));
    expect(screen.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled();
  });
  it('explains unavailable alignment without manufacturing a pitch path', async () => {
    mocks.alignment.mockResolvedValue(undefined);
    render(<NativePitchPractice audio={audio} japanese="あい" disabled={false} onStart={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Prepare with the native recording' }));
    await screen.findByText(/sound timing is unavailable/);
    expect(screen.queryByRole('img')).toBeNull();
  });
});
