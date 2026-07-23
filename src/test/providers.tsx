import type { ReactNode } from 'react';

import { AuthProvider } from '../sync/auth';
import { SyncProvider } from '../sync/SyncProvider';

export function withAppProviders(children: ReactNode) {
  return (
    <AuthProvider>
      <SyncProvider>{children}</SyncProvider>
    </AuthProvider>
  );
}
