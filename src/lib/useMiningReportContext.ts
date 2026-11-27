import { useEffect, useRef } from 'react';

import { installMiningLifecycleListeners, miningDiagnosticsSnapshot } from './miningDiagnostics';
import { registerReportContext } from './reportContext';

/**
 * Attach the import page's state plus the mining connection log to "Report
 * issue" (context key `miningImport`). `state` is the latest render's values;
 * `live` is called at report time for values kept outside React state.
 */
export function useMiningReportContext(
  page: string,
  state: Record<string, unknown>,
  live?: () => Record<string, unknown>,
): void {
  const stateRef = useRef(state);
  const liveRef = useRef(live);
  useEffect(() => {
    stateRef.current = state;
    liveRef.current = live;
  });
  useEffect(() => {
    installMiningLifecycleListeners();
    return registerReportContext('miningImport', () => ({
      page,
      ...stateRef.current,
      ...(liveRef.current?.() ?? {}),
      connection: miningDiagnosticsSnapshot(),
    }));
  }, [page]);
}

/**
 * Bookkeeping for the mount-time "reconnect to the saved job" loop: counts
 * attempts and runs one `/health` probe on the first network failure, so a
 * report shows whether the service is reachable at all from this device.
 */
export function createResumeTracker(probe: () => Promise<unknown>) {
  const tracker = {
    attempts: 0,
    failures: 0,
    startedAt: new Date().toISOString(),
    probed: false,
    noteAttempt() {
      tracker.attempts += 1;
    },
    noteFailure() {
      tracker.failures += 1;
      if (!tracker.probed) {
        tracker.probed = true;
        void probe();
      }
    },
    snapshot() {
      return {
        attempts: tracker.attempts,
        failures: tracker.failures,
        startedAt: tracker.startedAt,
      };
    },
  };
  return tracker;
}
