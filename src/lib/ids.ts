export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable non-cryptographic hash for sentence IDs from normalized Japanese. */
export function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function sentenceIdFromNormalizedKey(normalizedKey: string): string {
  return `sent_${hashString(normalizedKey)}`;
}

/**
 * 128-bit non-cryptographic hash (cyrb128), as four uint32s. Only used to derive
 * stable ids from natural keys — collision resistance against an adversary is
 * not a goal, spreading a user's few thousand keys over 128 bits is.
 */
function hash128(input: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < input.length; i += 1) {
    const k = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/**
 * Same inputs, same id — on every device. For get-or-create rows (kanji,
 * vocabulary items, grammar patterns and their links), where two devices
 * minting the same natural key with random ids is what produced duplicate-key
 * errors and orphaned links. `ownerId` is part of the key because ids are
 * global primary keys server-side: two users studying 宮 must not collide.
 * Shaped like `${prefix}_${uuid}` so it is indistinguishable from `createId`.
 */
export function deterministicId(prefix: string, ownerId: string, ...parts: string[]): string {
  const hex = hash128([ownerId, ...parts].join('\u0000'))
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');
  return `${prefix}_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
