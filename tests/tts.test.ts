import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readSettings, resetDbForTests } from '../src/db/database';
import { updateSettings } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import {
  SpeechController,
  filterJapaneseVoices,
  selectJapaneseVoice,
} from '../src/lib/speech';

interface MockVoice {
  voiceURI: string;
  name: string;
  lang: string;
  default: boolean;
  localService: boolean;
}

function voice(overrides: Partial<MockVoice>): SpeechSynthesisVoice {
  return {
    voiceURI: 'uri',
    name: 'Voice',
    lang: 'ja-JP',
    default: false,
    localService: false,
    ...overrides,
  } as SpeechSynthesisVoice;
}

class MockUtterance {
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

class MockSynth {
  spoken: MockUtterance[] = [];
  cancelCount = 0;
  voices: SpeechSynthesisVoice[] = [];

  getVoices(): SpeechSynthesisVoice[] {
    return this.voices;
  }

  cancel(): void {
    this.cancelCount += 1;
  }

  speak(utterance: unknown): void {
    this.spoken.push(utterance as MockUtterance);
  }

  addEventListener(): void {}
  removeEventListener(): void {}
}

describe('Japanese voice selection', () => {
  const english = voice({ voiceURI: 'en-1', name: 'Samantha', lang: 'en-US' });
  const kyoko = voice({ voiceURI: 'ja-kyoko', name: 'Kyoko', localService: true });
  const otoya = voice({ voiceURI: 'ja-otoya', name: 'Otoya' });
  const hattori = voice({ voiceURI: 'ja-hattori', name: 'Hattori', default: true });

  it('filters to voices whose language starts with ja', () => {
    const result = filterJapaneseVoices([english, kyoko, otoya]);
    expect(result.map((item) => item.name)).toEqual(['Kyoko', 'Otoya']);
  });

  it('prefers a saved voiceURI', () => {
    const selected = selectJapaneseVoice(
      [english, kyoko, otoya, hattori],
      'ja-otoya',
    );
    expect(selected?.name).toBe('Otoya');
  });

  it('falls back to a saved voice name when the URI is gone', () => {
    const selected = selectJapaneseVoice(
      [english, kyoko, otoya],
      'ja-removed',
      'Otoya',
    );
    expect(selected?.name).toBe('Otoya');
  });

  it('prefers a default Japanese voice over local and first', () => {
    const selected = selectJapaneseVoice([english, kyoko, otoya, hattori]);
    expect(selected?.name).toBe('Hattori');
  });

  it('prefers a local-service voice when no default exists', () => {
    const selected = selectJapaneseVoice([english, otoya, kyoko]);
    expect(selected?.name).toBe('Kyoko');
  });

  it('falls back to the first Japanese voice, then to none', () => {
    expect(selectJapaneseVoice([english, otoya])?.name).toBe('Otoya');
    expect(selectJapaneseVoice([english])).toBeNull();
  });
});

describe('SpeechController playback state', () => {
  let synth: MockSynth;

  beforeEach(() => {
    synth = new MockSynth();
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ignores empty and whitespace-only text', () => {
    const controller = new SpeechController();
    expect(controller.speak('')).toBe(false);
    expect(controller.speak('   ')).toBe(false);
    expect(synth.spoken).toHaveLength(0);
  });

  it('cancels existing playback before starting new playback', () => {
    const controller = new SpeechController();
    controller.speak('空は青い。', { itemId: 'a' });
    controller.speak('木々の緑。', { itemId: 'b' });
    expect(synth.cancelCount).toBe(2);
    expect(synth.spoken).toHaveLength(2);
    expect(synth.spoken[1]!.lang).toBe('ja-JP');
    expect(controller.getSnapshot().activeItemId).toBe('b');
    expect(controller.getSnapshot().isSpeaking).toBe(true);
  });

  it('applies rate, pitch, volume, and trims text', () => {
    const controller = new SpeechController();
    controller.speak('  空は青い。  ', { rate: 0.75, pitch: 1.1, volume: 0.5 });
    const utterance = synth.spoken[0]!;
    expect(utterance.text).toBe('空は青い。');
    expect(utterance.rate).toBe(0.75);
    expect(utterance.pitch).toBe(1.1);
    expect(utterance.volume).toBe(0.5);
  });

  it('selects a preferred installed voice by URI', () => {
    synth.voices = [
      voice({ voiceURI: 'ja-kyoko', name: 'Kyoko' }),
      voice({ voiceURI: 'ja-otoya', name: 'Otoya' }),
    ];
    const controller = new SpeechController();
    controller.speak('空は青い。', { voiceURI: 'ja-otoya' });
    expect(synth.spoken[0]!.voice?.name).toBe('Otoya');
  });

  it('leaves the voice unset when no Japanese voice exists', () => {
    synth.voices = [voice({ voiceURI: 'en-1', lang: 'en-US' })];
    const controller = new SpeechController();
    controller.speak('空は青い。');
    expect(synth.spoken[0]!.voice).toBeNull();
  });

  it('clears the active state on completion and on error', () => {
    const controller = new SpeechController();
    const onError = vi.fn();
    controller.speak('空は青い。', { itemId: 'a' });
    synth.spoken[0]!.onend?.();
    expect(controller.getSnapshot().isSpeaking).toBe(false);
    expect(controller.getSnapshot().activeItemId).toBeNull();

    controller.speak('木々の緑。', { itemId: 'b', onError });
    synth.spoken[1]!.onerror?.({ error: 'synthesis-failed' });
    expect(controller.getSnapshot().isSpeaking).toBe(false);
    expect(controller.getSnapshot().activeItemId).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('does not report interruption by newer playback as an error', () => {
    const controller = new SpeechController();
    const onError = vi.fn();
    controller.speak('空は青い。', { itemId: 'a', onError });
    controller.speak('木々の緑。', { itemId: 'b' });
    synth.spoken[0]!.onerror?.({ error: 'interrupted' });
    expect(onError).not.toHaveBeenCalled();
    expect(controller.getSnapshot().activeItemId).toBe('b');
  });

  it('prevents stale utterance events from clearing newer playback', () => {
    const controller = new SpeechController();
    controller.speak('空は青い。', { itemId: 'a' });
    const stale = synth.spoken[0]!;
    controller.speak('木々の緑。', { itemId: 'b' });
    stale.onend?.();
    expect(controller.getSnapshot().isSpeaking).toBe(true);
    expect(controller.getSnapshot().activeItemId).toBe('b');
  });

  it('stop() cancels playback and clears state', () => {
    const controller = new SpeechController();
    controller.speak('空は青い。', { itemId: 'a' });
    controller.stop();
    expect(synth.cancelCount).toBe(2);
    expect(controller.getSnapshot().isSpeaking).toBe(false);
    expect(controller.getSnapshot().activeItemId).toBeNull();
    // A stale onend after stop must not resurrect or throw.
    synth.spoken[0]!.onend?.();
    expect(controller.getSnapshot().isSpeaking).toBe(false);
  });

  it('plays a chunk sequence in order using utterance lifecycle events', () => {
    const controller = new SpeechController();
    const onEnd = vi.fn();
    controller.speakSequence(
      [
        { itemId: 'c1', text: '空は' },
        { itemId: 'c2', text: '  ' },
        { itemId: 'c3', text: '青くて、' },
      ],
      { onEnd },
    );
    expect(synth.spoken).toHaveLength(1);
    expect(controller.getSnapshot().activeItemId).toBe('c1');

    synth.spoken[0]!.onend?.();
    expect(synth.spoken).toHaveLength(2);
    expect(synth.spoken[1]!.text).toBe('青くて、');
    expect(controller.getSnapshot().activeItemId).toBe('c3');

    synth.spoken[1]!.onend?.();
    expect(controller.getSnapshot().isSpeaking).toBe(false);
    expect(controller.getSnapshot().activeItemId).toBeNull();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('a new utterance cancels the remainder of a sequence', () => {
    const controller = new SpeechController();
    controller.speakSequence([
      { itemId: 'c1', text: '空は' },
      { itemId: 'c2', text: '青くて、' },
    ]);
    controller.speak('別の文。', { itemId: 'other' });
    // Stale sequence completion must not schedule the next chunk.
    synth.spoken[0]!.onend?.();
    expect(synth.spoken).toHaveLength(2);
    expect(controller.getSnapshot().activeItemId).toBe('other');
  });
});

describe('TTS settings persistence', () => {
  beforeEach(() => {
    resetDbForTests(`tts-${createId('db')}`);
  });

  it('saves and restores voice and rate preferences', async () => {
    await updateSettings({
      tts: {
        voiceURI: 'ja-kyoko',
        preferredVoiceName: 'Kyoko',
        rate: 0.75,
        pitch: 1.0,
        volume: 1.0,
      },
    });
    const settings = await readSettings();
    expect(settings.tts.voiceURI).toBe('ja-kyoko');
    expect(settings.tts.preferredVoiceName).toBe('Kyoko');
    expect(settings.tts.rate).toBe(0.75);
  });

  it('supplies default TTS settings for records written before the feature', async () => {
    // Simulate a pre-TTS settings record.
    const { getDb } = await import('../src/db/repository');
    const db = getDb();
    const legacy = {
      id: 'settings',
      theme: 'system',
      hideSatoriEnglishInitially: true,
      showReadingsInitially: false,
      defaultImportDestination: 'inbox',
      textDisplayMode: 'plain',
    };
    await db.settings.put(legacy as never);
    const settings = await readSettings();
    expect(settings.tts).toEqual({ rate: 0.9, pitch: 1.0, volume: 1.0 });
  });
});
