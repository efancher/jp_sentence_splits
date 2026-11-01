import { dictationTileIndex } from './earTiles';

/**
 * One-time cleanup planning for the old nine-dictation-cards-per-sentence
 * behaviour (docs/STATUS.md): a sentence now seeds a single `dictation_tile:N`
 * card, but sentences seeded earlier may hold up to nine. For each sentence the
 * card with the most reviews is kept (the one the learner actually practised;
 * ties go to the lowest tile index) and the rest are retired. Reviews are
 * append-only evidence and stay.
 */
export interface DictationItem {
  id: string;
  subjectId: string;
  activityType: string;
}

export interface DictationRetirementPlan {
  keep: string[];
  retire: string[];
  /** Retired items that had reviews, so the report can show what is being set aside. */
  retiredWithReviews: string[];
}

export function planDictationRetirement(
  items: readonly DictationItem[],
  reviewCountByItem: ReadonlyMap<string, number>,
): DictationRetirementPlan {
  const bySentence = new Map<string, { item: DictationItem; tile: number }[]>();
  for (const item of items) {
    const tile = dictationTileIndex(item.activityType);
    if (tile === null) continue;
    const list = bySentence.get(item.subjectId) ?? [];
    list.push({ item, tile });
    bySentence.set(item.subjectId, list);
  }
  const plan: DictationRetirementPlan = { keep: [], retire: [], retiredWithReviews: [] };
  for (const entries of bySentence.values()) {
    entries.sort(
      (a, b) =>
        (reviewCountByItem.get(b.item.id) ?? 0) - (reviewCountByItem.get(a.item.id) ?? 0) ||
        a.tile - b.tile ||
        a.item.id.localeCompare(b.item.id),
    );
    const [keeper, ...rest] = entries;
    plan.keep.push(keeper!.item.id);
    for (const { item } of rest) {
      plan.retire.push(item.id);
      if ((reviewCountByItem.get(item.id) ?? 0) > 0) plan.retiredWithReviews.push(item.id);
    }
  }
  return plan;
}
