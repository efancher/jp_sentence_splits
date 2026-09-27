import { hashString } from './ids';

/**
 * Stable shuffle: the output order depends only on `seed` and each item's id,
 * never on the input order. Used by the pitch-accent drill so a Dexie
 * live-query refresh (which hands back a fresh array) doesn't reorder the
 * list mid-drill — the order only changes when the caller picks a new seed.
 */
export function seededShuffle<T>(
  items: readonly T[],
  id: (item: T) => string,
  seed: string,
): T[] {
  return [...items].sort(
    (a, b) =>
      Number.parseInt(hashString(`${seed}:${id(a)}`), 16) -
      Number.parseInt(hashString(`${seed}:${id(b)}`), 16),
  );
}

/**
 * Same stable, id-keyed shuffle as `seededShuffle`, but items with a higher
 * `weight` are more likely to land earlier — used by the pitch-accent drill
 * to surface under-mastered material more often without making the queue
 * fully predictable (a plain "weak items first" sort would). Weighted
 * reservoir-sampling key (Efraimidis–Spirakis): draw a uniform (0, 1] value
 * per item from the same seed/id hash `seededShuffle` uses, then sort by
 * `-ln(u) / weight` ascending — a higher weight shrinks the key, so it sorts
 * earlier on average, while staying exactly as deterministic per seed.
 */
export function weightedSeededShuffle<T>(
  items: readonly T[],
  id: (item: T) => string,
  seed: string,
  weight: (item: T) => number,
): T[] {
  const key = (item: T): number => {
    const hash = Number.parseInt(hashString(`${seed}:${id(item)}`), 16);
    const uniform = Math.max(hash / 0x100000000, Number.EPSILON);
    return -Math.log(uniform) / Math.max(weight(item), Number.EPSILON);
  };
  return [...items].sort((a, b) => key(a) - key(b));
}
