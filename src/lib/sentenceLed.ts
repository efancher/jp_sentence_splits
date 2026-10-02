import type { AppSettings } from '../domain/types';

type FlowSettings = Pick<
  AppSettings,
  'sentenceLedFlow' | 'legacyDrillsPaused' | 'sentenceFirstPlanning' | 'sequentialStudyMode'
>;

/** Sentence-led flow is the default; only an explicit `false` turns it off. */
export function isSentenceLedFlow(settings: Partial<FlowSettings> | undefined): boolean {
  return settings?.sentenceLedFlow ?? true;
}

/** Separate word/grammar drills are withheld by the manual pause or by the sentence-led flow. */
export function effectiveLegacyDrillsPaused(settings: Partial<FlowSettings> | undefined): boolean {
  return (settings?.legacyDrillsPaused ?? false) || isSentenceLedFlow(settings);
}

/** Planner explore steps become sentence lessons (walkthrough first) under the sentence-led flow. */
export function effectiveSentenceFirstPlanning(settings: Partial<FlowSettings> | undefined): boolean {
  return (settings?.sentenceFirstPlanning ?? false) || isSentenceLedFlow(settings);
}

export function isSequentialStudyMode(settings: Partial<FlowSettings> | undefined): boolean {
  return settings?.sequentialStudyMode ?? false;
}
