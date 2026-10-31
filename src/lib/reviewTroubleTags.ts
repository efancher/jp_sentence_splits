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
  { value: 'sound', label: 'Sound', hint: 'Hard to say or hear: rhythm, pitch or speed' },
];

const TAG_ORDER = REVIEW_TROUBLE_TAGS.map((tag) => tag.value);

/** Stable, de-duplicated, display-ordered tag list. */
export function normalizeTroubleTags(tags: readonly ReviewTroubleTag[]): ReviewTroubleTag[] {
  return TAG_ORDER.filter((value) => tags.includes(value));
}

/**
 * Which follow-up each tag asks for: knowledge gaps (reading, meaning, kanji)
 * go to a walkthrough "fresh try"; a sound problem goes to shadowing.
 */
export function routeTroubleTags(tags: readonly ReviewTroubleTag[]): {
  freshTry: boolean;
  shadow: boolean;
} {
  return {
    freshTry: tags.some((tag) => tag === 'reading' || tag === 'meaning' || tag === 'kanji'),
    shadow: tags.includes('sound'),
  };
}
