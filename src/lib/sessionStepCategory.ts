import type { PlannerSessionStep } from '../domain/types';

export type SessionStepCategory =
  | 'learn_sentence'
  | 'fresh_try'
  | 'vocabulary'
  | 'grammar'
  | 'review'
  | 'shadowing'
  | 'game';

export const SESSION_STEP_CATEGORY_LABELS: Record<SessionStepCategory, string> = {
  learn_sentence: 'Learn new sentence',
  fresh_try: 'Fresh try',
  vocabulary: 'Vocabulary',
  grammar: 'Grammar',
  review: 'Review',
  shadowing: 'Shadowing',
  game: 'Game break',
};

export const SESSION_STEP_CATEGORY_ORDER: SessionStepCategory[] = [
  'learn_sentence',
  'fresh_try',
  'vocabulary',
  'grammar',
  'review',
  'shadowing',
  'game',
];

/** The learner-facing kind of a step. Older persisted fresh tries lack `revisit`, so the label prefix is the fallback. */
export function sessionStepCategory(
  step: Pick<PlannerSessionStep, 'targetKind' | 'bucket' | 'revisit' | 'label'>,
): SessionStepCategory {
  switch (step.targetKind) {
    case 'sentence_learning':
      return step.revisit || step.label.startsWith('Fresh try') ? 'fresh_try' : 'learn_sentence';
    case 'continue_book':
      return 'learn_sentence';
    case 'vocabulary_review':
    case 'vocabulary_detail':
      return 'vocabulary';
    case 'grammar_detail':
    case 'grammar_noticing':
      return 'grammar';
    case 'review':
      return 'review';
    case 'shadow':
      return 'shadowing';
    case 'game':
      return 'game';
  }
}
