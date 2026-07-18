import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import 'fake-indexeddb/auto';

import { afterEach, vi } from 'vitest';

import { resetDbForTests } from '../db/database';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}));

afterEach(async () => {
  cleanup();
  const db = resetDbForTests(`satori-glossbook-test-${Math.random()}`);
  await db.delete();
});
