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
