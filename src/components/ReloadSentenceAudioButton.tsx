import { useState } from 'react';

import { refreshSentenceAudioFromCloud } from '../sync/audioSync';

/**
 * Pull this one sentence's clips fresh from the cloud — for a clip that was
 * re-cut, replaced or removed on another device while this one keeps playing
 * the old audio. Cheaper and safer than Settings' full re-download.
 */
export function ReloadSentenceAudioButton({ sentenceId }: { sentenceId: string }) {
  const [state, setState] = useState<'idle' | 'busy'>('idle');
  const [message, setMessage] = useState('');

  async function reload() {
    setState('busy');
    setMessage('');
    try {
      const result = await refreshSentenceAudioFromCloud(sentenceId);
      if (!result) setMessage('Offline or signed out — nothing reloaded.');
      else if (result.refreshed === 0 && result.removed === 0) setMessage('No clips in the cloud for this sentence.');
      else setMessage(`Reloaded ${result.refreshed} clip${result.refreshed === 1 ? '' : 's'}${result.removed ? `, removed ${result.removed}` : ''}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Reload failed.');
    } finally {
      setState('idle');
    }
  }

  return (
    <>
      <button type="button" disabled={state === 'busy'} onClick={() => void reload()}>
        {state === 'busy' ? 'Reloading…' : 'Reload audio'}
      </button>
      {message ? <span className="muted" role="status">{message}</span> : null}
    </>
  );
}
