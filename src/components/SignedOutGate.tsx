import { useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { useAuth } from '../sync/auth';
import { readSyncMeta } from '../sync/queue';

/**
 * Blocks the app behind a sign-in screen when this device *had* a session and
 * lost it (expired refresh token, remote sign-out). A device that never signed
 * in, or that signed out on purpose, is left alone — the app stays local-first.
 * "Continue offline" dismisses for this page load only, so it re-prompts on the
 * next launch rather than letting unsynced work pile up unnoticed.
 */
export function SignedOutGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const meta = useLiveQuery(() => readSyncMeta(), []);
  const [dismissed, setDismissed] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!auth.configured || auth.session || dismissed) return <>{children}</>;
  // Wait for the first session check and the meta read to avoid a flash.
  if (auth.loading || meta === undefined) return null;
  if (!meta.wasSignedIn) return <>{children}</>;

  return (
    <main
      className="stack"
      style={{ maxWidth: 420, margin: '10vh auto', padding: '1rem' }}
    >
      <h2 style={{ margin: 0 }}>You’ve been signed out</h2>
      <p className="muted" style={{ margin: 0 }}>
        Sign in to resume syncing. Anything you study while signed out stays on
        this device and uploads once you sign back in.
      </p>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          void auth
            .signIn(email, password)
            .then((result) => {
              if (result.error) setError(result.error);
            })
            .catch((reason: unknown) => {
              setError(reason instanceof Error ? reason.message : 'Sign-in failed. Please try again.');
            })
            .finally(() => setBusy(false));
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          autoComplete="email"
          required
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          required
        />
        {error ? <div style={{ color: 'var(--danger)' }}>{error}</div> : null}
        <button type="submit" className="primary" disabled={busy}>
          Sign in
        </button>
      </form>
      <button type="button" onClick={() => setDismissed(true)}>
        Continue offline
      </button>
    </main>
  );
}
