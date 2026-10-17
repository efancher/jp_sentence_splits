import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './styles/global.css';
import { APP_NAME } from './appConfig';
import { ensureSettings } from './db/database';
import { SignedOutGate } from './components/SignedOutGate';
import { AuthProvider } from './sync/auth';
import { SyncProvider } from './sync/SyncProvider';

document.title = APP_NAME;

void ensureSettings().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuthProvider>
        <SyncProvider>
          <SignedOutGate>
            <App />
          </SignedOutGate>
        </SyncProvider>
      </AuthProvider>
    </StrictMode>,
  );
});
