import type { TtsSettings } from '../domain/types';

/**
 * Japanese text-to-speech via the Web Speech API.
 *
 * A single shared SpeechController owns all playback so that starting any
 * utterance cancels the previous one, and so stale utterance events (which
 * iOS Safari can deliver late) can never clear the state of newer playback.
 */

export interface SpeakOptions {
  /** Identifier shown as "active" while this text is speaking. */
  itemId?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  voiceURI?: string;
  preferredVoiceName?: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: unknown) => void;
}

export interface SequenceItem {
  itemId: string;
  text: string;
}

export interface SpeechSnapshot {
  supported: boolean;
  isSpeaking: boolean;
  activeItemId: string | null;
  voices: SpeechSynthesisVoice[];
}

export function isSpeechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window
  );
}

export function filterJapaneseVoices(
  voices: readonly SpeechSynthesisVoice[],
): SpeechSynthesisVoice[] {
  return voices.filter((voice) => voice.lang?.toLowerCase().startsWith('ja'));
}

/**
 * Preference order: saved voiceURI → saved name → browser default →
 * locally installed voice → first Japanese voice → none (browser picks
 * from `lang = "ja-JP"`).
 */
export function selectJapaneseVoice(
  voices: readonly SpeechSynthesisVoice[],
  preferredVoiceURI?: string,
  preferredVoiceName?: string,
): SpeechSynthesisVoice | null {
  const japanese = filterJapaneseVoices(voices);
  return (
    japanese.find((voice) => voice.voiceURI === preferredVoiceURI) ??
    japanese.find((voice) => voice.name === preferredVoiceName) ??
    japanese.find((voice) => voice.default) ??
    japanese.find((voice) => voice.localService) ??
    japanese[0] ??
    null
  );
}

type Listener = () => void;

export class SpeechController {
  private generation = 0;
  private listeners = new Set<Listener>();
  private voices: SpeechSynthesisVoice[] = [];
  private voicesLoaded = false;
  private snapshot: SpeechSnapshot;

  constructor() {
    this.snapshot = {
      supported: isSpeechSupported(),
      isSpeaking: false,
      activeItemId: null,
      voices: [],
    };
  }

  getSnapshot = (): SpeechSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    this.ensureVoicesLoading();
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(patch: Partial<SpeechSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Voice lists load asynchronously on Safari; refresh on voiceschanged. */
  private ensureVoicesLoading(): void {
    if (this.voicesLoaded || !isSpeechSupported()) return;
    this.voicesLoaded = true;
    const synth = window.speechSynthesis;
    const update = () => {
      this.voices = synth.getVoices();
      this.notify({ voices: this.voices });
    };
    update();
    if ('addEventListener' in synth) {
      synth.addEventListener('voiceschanged', update);
    }
  }

  getVoices(): SpeechSynthesisVoice[] {
    this.ensureVoicesLoading();
    return this.voices;
  }

  speak(text: string, options: SpeakOptions = {}): boolean {
    const trimmed = text?.trim();
    if (!trimmed || !isSpeechSupported()) return false;

    const synth = window.speechSynthesis;
    // Stop existing speech so repeated taps do not build a queue.
    synth.cancel();
    const generation = ++this.generation;

    const utterance = this.buildUtterance(trimmed, options);
    const finish = (error?: unknown) => {
      if (generation !== this.generation) return;
      this.notify({ isSpeaking: false, activeItemId: null });
      if (error !== undefined) options.onError?.(error);
      else options.onEnd?.();
    };
    utterance.onstart = () => {
      if (generation !== this.generation) return;
      options.onStart?.();
    };
    utterance.onend = () => finish();
    utterance.onerror = (event) => {
      // "interrupted"/"canceled" arrive when we replace playback on purpose.
      if (event.error === 'interrupted' || event.error === 'canceled') {
        finish();
        return;
      }
      console.error('Speech synthesis error:', event.error ?? event);
      finish(event);
    };

    this.notify({
      isSpeaking: true,
      activeItemId: options.itemId ?? null,
    });
    synth.speak(utterance);
    return true;
  }

  /**
   * Plays items in order, advancing on each utterance's `onend`.
   * Any new speak()/stop() call cancels the remainder of the sequence.
   */
  speakSequence(items: readonly SequenceItem[], options: SpeakOptions = {}): boolean {
    const queue = items.filter((item) => item.text.trim());
    if (!queue.length || !isSpeechSupported()) return false;

    const synth = window.speechSynthesis;
    synth.cancel();
    const generation = ++this.generation;

    const playIndex = (index: number) => {
      if (generation !== this.generation) return;
      if (index >= queue.length) {
        this.notify({ isSpeaking: false, activeItemId: null });
        options.onEnd?.();
        return;
      }
      const item = queue[index]!;
      const utterance = this.buildUtterance(item.text.trim(), options);
      utterance.onend = () => playIndex(index + 1);
      utterance.onerror = (event) => {
        if (generation !== this.generation) return;
        if (event.error === 'interrupted' || event.error === 'canceled') {
          this.notify({ isSpeaking: false, activeItemId: null });
          return;
        }
        console.error('Speech synthesis error (sequence):', event.error ?? event);
        this.notify({ isSpeaking: false, activeItemId: null });
        options.onError?.(event);
      };
      this.notify({ isSpeaking: true, activeItemId: item.itemId });
      synth.speak(utterance);
    };

    playIndex(0);
    return true;
  }

  stop(): void {
    this.generation += 1;
    if (isSpeechSupported()) {
      window.speechSynthesis.cancel();
    }
    if (this.snapshot.isSpeaking || this.snapshot.activeItemId) {
      this.notify({ isSpeaking: false, activeItemId: null });
    }
  }

  private buildUtterance(
    text: string,
    options: SpeakOptions,
  ): SpeechSynthesisUtterance {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    utterance.rate = options.rate ?? 0.9;
    utterance.pitch = options.pitch ?? 1.0;
    utterance.volume = options.volume ?? 1.0;
    const voice = selectJapaneseVoice(
      this.getVoices(),
      options.voiceURI,
      options.preferredVoiceName,
    );
    if (voice) utterance.voice = voice;
    return utterance;
  }
}

export function ttsOptionsFromSettings(tts: TtsSettings): SpeakOptions {
  return {
    rate: tts.rate,
    pitch: tts.pitch,
    volume: tts.volume,
    voiceURI: tts.voiceURI,
    preferredVoiceName: tts.preferredVoiceName,
  };
}

/** Shared app-wide controller: one active utterance at a time. */
export const speechController = new SpeechController();
