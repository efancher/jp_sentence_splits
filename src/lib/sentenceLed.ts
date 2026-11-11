import type { AppSettings } from '../domain/types';
import { I_PLUS_ONE_STRETCH_EVERY } from './iPlusOne';

type FlowSettings = Pick<AppSettings, 'sequentialStudyMode' | 'iPlusOneOrdering' | 'iPlusOneStretchEvery'>;

/**
 * The retired word and grammar drill cards (vocabulary, confusion, conjugation,
 * word-listening and grammar). Review no longer serves or creates them; their
 * study items and reviews are kept as evidence for word strength and progress.
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
  settings: Partial<Pick<AppSettings, 'pitchAccentPaused' | 'sentenceCardsPaused'>> | undefined,
): boolean {
  if (LEGACY_DRILL_ACTIVITY_TYPES.has(activityType)) return false;
  if (PITCH_ACCENT_ACTIVITY_TYPES.has(activityType)) return !settings?.pitchAccentPaused;
  if (isSentenceCardActivityType(activityType)) return !settings?.sentenceCardsPaused;
  return true;
}

export function isSequentialStudyMode(settings: Partial<FlowSettings> | undefined): boolean {
  return settings?.sequentialStudyMode ?? false;
}

/** Opt-in: offer a book's new sentences by known-word coverage (i+1) instead of reading order. */
export function isIPlusOneOrdering(settings: Partial<FlowSettings> | undefined): boolean {
  return settings?.iPlusOneOrdering ?? false;
}

/** Every Nth i+1 slot is a harder sentence; 0 = never. Falls back to the default for anything that isn't a whole number >= 0. */
export function iPlusOneStretchEvery(settings: Partial<FlowSettings> | undefined): number {
  const value = settings?.iPlusOneStretchEvery;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : I_PLUS_ONE_STRETCH_EVERY;
}
