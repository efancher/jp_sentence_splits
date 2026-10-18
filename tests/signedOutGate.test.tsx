import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SignedOutGate } from '../src/components/SignedOutGate';
import { resetDbForTests } from '../src/db/database';
import { useAuth } from '../src/sync/auth';
import { readSyncMeta, updateSyncMeta } from '../src/sync/queue';

vi.mock('../src/sync/auth', () => ({ useAuth: vi.fn() }));

function authState(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  const value: ReturnType<typeof useAuth> = {
    configured: true, loading: false, session: null, user: null,
    signIn: vi.fn(async () => ({})), signUp: vi.fn(async () => ({})),
    signOut: vi.fn(async () => {}), resetPassword: vi.fn(async () => ({})),
    updatePassword: vi.fn(async () => ({})), ...overrides,
  };
  vi.mocked(useAuth).mockReturnValue(value);
  return value;
}

const gate = () => <SignedOutGate><div>Study workspace</div></SignedOutGate>;

beforeEach(async () => {
  resetDbForTests();
  await updateSyncMeta({ wasSignedIn: true });
  authState();
});

describe('sign-in recovery gate', () => {
  it('keeps a local-only installation usable even with old sync metadata', () => {
    authState({ configured: false });
    render(gate());
    expect(screen.getByText('Study workspace')).toBeInTheDocument();
  });

  it('waits for session discovery, then blocks an unexpectedly signed-out device', async () => {
    authState({ loading: true });
    const view = render(gate());
    expect(screen.queryByText('Study workspace')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    authState();
    view.rerender(gate());
    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByText('Study workspace')).not.toBeInTheDocument();
  });

  it('allows a never-signed-in or deliberately signed-out device', async () => {
    await updateSyncMeta({ wasSignedIn: false });
    render(gate());
    await screen.findByText('Study workspace');
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('continues offline for this mount without erasing the recovery reminder', async () => {
    const view = render(gate());
    fireEvent.click(await screen.findByRole('button', { name: 'Continue offline' }));
    expect(screen.getByText('Study workspace')).toBeInTheDocument();
    expect((await readSyncMeta()).wasSignedIn).toBe(true);
    view.unmount();
    render(gate());
    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByText('Study workspace')).not.toBeInTheDocument();
  });

  it('displays a rejected sign-in, prevents duplicate submission, and permits retry', async () => {
    let rejectSignIn!: (reason: Error) => void;
    const signIn = vi.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSignIn = reject; }))
      .mockResolvedValueOnce({ error: 'Invalid credentials' });
    authState({ signIn });
    render(gate());
    const submit = await screen.findByRole('button', { name: 'Sign in' });
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'learner@example.test' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'test-password' } });
    fireEvent.submit(submit.closest('form')!);
    fireEvent.submit(submit.closest('form')!);
    expect(submit).toBeDisabled();
    expect(signIn).toHaveBeenCalledTimes(1);
    await act(async () => rejectSignIn(new Error('Connection lost')));
    await screen.findByText('Connection lost');
    expect(submit).toBeEnabled();
    fireEvent.submit(submit.closest('form')!);
    await screen.findByText('Invalid credentials');
    expect(screen.queryByText('Connection lost')).not.toBeInTheDocument();
    expect(signIn).toHaveBeenLastCalledWith('learner@example.test', 'test-password');
    await waitFor(() => expect(submit).toBeEnabled());
  });
});
