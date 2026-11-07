import type { AppSettings } from '../domain/types';

type FlowSettings = Pick<
  AppSettings,
  'sentenceLedFlow' | 'legacyDrillsPaused' | 'sentenceFirstPlanning' | 'sequentialStudyMode' | 'iPlusOneOrdering'
>;

/** Sentence-led flow is the default; only an explicit `false` turns it off. */
export function isSentenceLedFlow(settings: Partial<FlowSettings> | undefined): boolean {
  return settings?.sentenceLedFlow ?? true;
}

/** Separate word/grammar drills are withheld by the manual pause or by the sentence-led flow. */
export function effectiveLegacyDrillsPaused(settings: Partial<FlowSettings> | undefined): boolean {
  return (settings?.legacyDrillsPaused ?? false) || isSentenceLedFlow(settings);
}

/**
 * Activity types ReviewPage withholds while word/grammar drills are paused
 * (its vocabulary, confusion, conjugation, word-listening and grammar
 * descriptors). Keep in step with the *_ACTIVITY_TYPES lists there.
 */
const LEGACY_DRILL_ACTIVITY_TYPES = new Set([
  'reading_retrieval',
  'cloze',
  'reading_production',
  'contrastive',
  'sentence_transformation',
  'word_listening',
  'grammar_recognition',
  'grammar_completion',
]);

/** Sentence-subject card types withheld by `settings.sentenceCardsPaused`; `dictation_tile:N` is matched by prefix. */
const SENTENCE_CARD_ACTIVITY_TYPES = new Set(['reading_in_context', 'listening', 'ear_tiles', 'dictation']);

export function isSentenceCardActivityType(activityType: string): boolean {
  return SENTENCE_CARD_ACTIVITY_TYPES.has(activityType) || activityType.startsWith('dictation_tile:');
}

const PITCH_ACCENT_ACTIVITY_TYPES = new Set(['pitch_accent', 'pitch_accent_production']);

/** Whether Review currently serves this card type under the given settings. */
export function isActivityTypeInUse(
  activityType: string,
  settings: Partial<FlowSettings & Pick<AppSettings, 'pitchAccentPaused' | 'sentenceCardsPaused'>> | undefined,
): boolean {
  if (LEGACY_DRILL_ACTIVITY_TYPES.has(activityType)) return !effectiveLegacyDrillsPaused(settings);
  if (PITCH_ACCENT_ACTIVITY_TYPES.has(activityType)) return !settings?.pitchAccentPaused;
  if (isSentenceCardActivityType(activityType)) return !settings?.sentenceCardsPaused;
  return true;
}

/** Planner explore steps become sentence lessons (walkthrough first) under the sentence-led flow. */
export function effectiveSentenceFirstPlanning(settings: Partial<FlowSettings> | undefined): boolean {
  return (settings?.sentenceFirstPlanning ?? false) || isSentenceLedFlow(settings);
}

export function isSequentialStudyMode(settings: Partial<FlowSettings> | undefined): boolean {
  return settings?.sequentialStudyMode ?? false;
}

/** Opt-in: offer a book's new sentences by known-word coverage (i+1) instead of reading order. */
export function isIPlusOneOrdering(settings: Partial<FlowSettings> | undefined): boolean {
  return settings?.iPlusOneOrdering ?? false;
}
