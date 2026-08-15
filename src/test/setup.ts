import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import 'fake-indexeddb/auto';

import { afterEach, vi } from 'vitest';

import { clearDbInstanceForTests, getDb, hasDbInstanceForTests } from '../db/database';

// Default is 1000ms. Several tests chain a real debounced autosave
// (AUTOSAVE_DEBOUNCE_MS, 450ms) or a useLiveQuery-driven Dexie
// read/write/re-render cycle behind a waitFor/findBy* — comfortably inside
// 1000ms in isolation, but the full suite runs many test files' worth of
// jsdom + fake-indexeddb work across parallel workers, and under that CPU
// contention a real setTimeout can occasionally land well past 1000ms even
// though nothing is actually broken. Kept deliberately modest (not e.g.
// 5000ms): the real fix for the flakiest case (tests/ui.test.tsx's
// Next/Previous race) was closing an actual race in the test itself, not
// waiting longer — a bigger number here mostly just makes a genuinely
// broken assertion elsewhere in the suite take longer to fail.
configure({ asyncUtilTimeout: 3000 });

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}));

// fake-indexeddb clones every value on insertion via the global
// structuredClone() (see cloneValueForInsertion in its source) — but that's
// Node's own structuredClone, which doesn't recognize jsdom's Blob as a
// real Blob (jsdom ships its own distinct Blob class; verified directly:
// `structuredClone(new Blob(['x'])) instanceof Blob` is false under
// vitest's jsdom environment, deterministically). A Blob field read back
// after any Dexie round-trip is therefore a plain object with the right
// shape but the wrong prototype — never happens in a real browser, purely
// an artifact of this test environment's Blob/structuredClone mismatch.
// Patched once, globally, rather than per test file with a
// mock-in-beforeEach/delete-in-afterEach dance — that pattern (previously
// in tests/shadowPage.test.tsx) raced against this same setup file's
// afterEach across nested hook ordering, which was a real source of
// flakiness under the full suite (never reproduced standalone, or with
// this file run alone). Real Blobs (e.g. constructed directly in a test,
// never round-tripped through Dexie) still go through the real
// implementation unchanged.
const realCreateObjectURL = URL.createObjectURL?.bind(URL);
if (realCreateObjectURL) {
  URL.createObjectURL = ((obj: Parameters<typeof URL.createObjectURL>[0]) =>
    obj instanceof Blob
      ? realCreateObjectURL(obj)
      : `blob:test-fallback-${Math.random().toString(36).slice(2)}`) as typeof URL.createObjectURL;
}
if (URL.revokeObjectURL) {
  URL.revokeObjectURL = () => {};
}

afterEach(async () => {
  cleanup();
  // Skip entirely for tests that never touched the db (getDb()/
  // resetDbForTests() never called) — no point paying for an IndexedDB
  // open/close/delete cycle and a settle tick when there's nothing to clean
  // up (e.g. tts.test.ts's SpeechController/voice-selection tests).
  if (!hasDbInstanceForTests()) return;

  // Give any useLiveQuery read still in flight from a component that was
  // just unmounted a tick to resolve and hit dexie-react-hooks' own
  // "am I still subscribed" guard, before the db it was reading from gets
  // closed out from under it. Previously this created and deleted an
  // unrelated, freshly-named throwaway database instead of the one the
  // test actually used, which didn't close the real one until the *next*
  // test's beforeEach — a likely source of the shadowPage.test.tsx/
  // ui.test.tsx flakiness under the full suite (never reproduced standalone).
  // A single macrotask tick is a heuristic, not a guarantee — it doesn't
  // cover a write whose own promise chain outlives one tick (e.g. a real
  // multi-await Dexie transaction under heavy CPU contention). Verified
  // empirically (35 consecutive full-suite runs, 0 failures) rather than
  // proven airtight; if this ever regresses, that's the gap to close next.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const db = getDb();
  db.close();
  await db.delete();
  // Leave a fresh, usable instance behind so a test that calls getDb()
  // without its own resetDbForTests() in beforeEach (relying on the old
  // "always valid" singleton) gets a real, open database instead of
  // Dexie's DatabaseClosedError from the one just closed above (close()
  // defaults to disabling auto-reopen).
  clearDbInstanceForTests();
});
