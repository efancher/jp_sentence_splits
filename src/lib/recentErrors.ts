const MAX_ERRORS = 10;
const recentErrors: { at: string; message: string }[] = [];
let errorCaptureInstalled = false;

export function installErrorCapture() {
  if (errorCaptureInstalled || typeof window === 'undefined') return;
  errorCaptureInstalled = true;
  const push = (message: string) => {
    recentErrors.push({ at: new Date().toISOString(), message: message.slice(0, 300) });
    if (recentErrors.length > MAX_ERRORS) recentErrors.shift();
  };
  window.addEventListener('error', (event) => push(event.message));
  window.addEventListener('unhandledrejection', (event) =>
    push(`unhandledrejection: ${String(event.reason)}`),
  );
}

export function getRecentErrors() {
  return [...recentErrors];
}
