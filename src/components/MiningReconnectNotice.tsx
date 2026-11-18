/**
 * Shown while an import page retries reconnecting to the saved mining job.
 * Retries continue on network errors (a phone on a flaky connection), but the
 * last error is shown so a device that can't reach the tailnet service at all
 * (Tailscale disconnected) isn't a silent, endless "Reconnecting…".
 */
export function MiningReconnectNotice({
  error,
  onStop,
}: {
  error: string;
  onStop: () => void;
}) {
  if (!error) {
    return <div className="muted">Reconnecting to your last mining job…</div>;
  }
  return (
    <div className="stack" style={{ gap: '0.4rem' }} role="status">
      <div className="muted">
        Can't reach the mining service ({error}). Still retrying every few
        seconds. Check that Tailscale is connected on this device.
      </div>
      <div>
        <button type="button" onClick={onStop}>
          Stop waiting
        </button>
      </div>
      <div className="muted" style={{ fontSize: '0.85rem' }}>
        The job stays saved on the server; reload this page later to pick it up.
      </div>
    </div>
  );
}
