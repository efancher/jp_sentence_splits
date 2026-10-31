import type { ReviewTroubleTag } from '../domain/types';

/**
 * Review "what was hard?" chips (docs/ROADMAP.md "Review trouble tags and
 * remediation queue"). The learner names the weakness; the tags never choose
 * the FSRS rating and never credit related cards. They only queue a follow-up
 * activity *after* the review, so the review itself stays an unassisted test.
 */
export const REVIEW_TROUBLE_TAGS: { value: ReviewTroubleTag; label: string; hint: string }[] = [
  { value: 'reading', label: 'Reading', hint: 'Could not recall how a word is read' },
  { value: 'meaning', label: 'Meaning', hint: 'Could not recall what a word or the sentence means' },
  { value: 'kanji', label: 'Kanji', hint: 'Did not recognise the kanji form' },
];

const TAG_ORDER = REVIEW_TROUBLE_TAGS.map((tag) => tag.value);

/** Stable, de-duplicated, display-ordered tag list. */
export function normalizeTroubleTags(tags: readonly ReviewTroubleTag[]): ReviewTroubleTag[] {
  return TAG_ORDER.filter((value) => tags.includes(value));
}

/**
 * Which follow-up each tag asks for: knowledge gaps (reading, meaning, kanji)
 * go to a walkthrough "fresh try". (A "sound" tag used to queue shadowing; it
 * was removed 2026-10-31 once shadowing became its own self-rated card.)
 */
export function routeTroubleTags(tags: readonly ReviewTroubleTag[]): {
  freshTry: boolean;
} {
  return {
    freshTry: tags.some((tag) => tag === 'reading' || tag === 'meaning' || tag === 'kanji'),
  };
}
