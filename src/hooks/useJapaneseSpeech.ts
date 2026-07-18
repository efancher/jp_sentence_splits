import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useSyncExternalStore } from 'react';

import { readSettings } from '../db/database';
import type { TtsSettings } from '../domain/types';
import {
  speechController,
  ttsOptionsFromSettings,
  type SequenceItem,
  type SpeakOptions,
  type SpeechSnapshot,
} from '../lib/speech';

export interface JapaneseSpeech {
  supported: boolean;
  isSpeaking: boolean;
  activeItemId: string | null;
  voices: SpeechSynthesisVoice[];
  ttsSettings: TtsSettings | undefined;
  speak: (text: string, options?: SpeakOptions) => void;
  speakSequence: (items: readonly SequenceItem[], options?: SpeakOptions) => void;
  stop: () => void;
}

/**
 * Access the shared Japanese speech controller with saved TTS preferences
 * applied. Playback is global: speaking from any component cancels playback
 * started elsewhere.
 */
export function useJapaneseSpeech(): JapaneseSpeech {
  const snapshot: SpeechSnapshot = useSyncExternalStore(
    speechController.subscribe,
    speechController.getSnapshot,
  );
  const settings = useLiveQuery(() => readSettings(), []);
  const tts = settings?.tts;

  const speak = useCallback(
    (text: string, options?: SpeakOptions) => {
      speechController.speak(text, {
        ...(tts ? ttsOptionsFromSettings(tts) : {}),
        ...options,
      });
    },
    [tts],
  );

  const speakSequence = useCallback(
    (items: readonly SequenceItem[], options?: SpeakOptions) => {
      speechController.speakSequence(items, {
        ...(tts ? ttsOptionsFromSettings(tts) : {}),
        ...options,
      });
    },
    [tts],
  );

  const stop = useCallback(() => speechController.stop(), []);

  return {
    supported: snapshot.supported,
    isSpeaking: snapshot.isSpeaking,
    activeItemId: snapshot.activeItemId,
    voices: snapshot.voices,
    ttsSettings: tts,
    speak,
    speakSequence,
    stop,
  };
}
