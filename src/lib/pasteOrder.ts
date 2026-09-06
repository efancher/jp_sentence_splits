import { normalizeForPasteMatch } from './normalize';

export type PasteOrderSentence = {
  id: string;
  japanese: string;
};

export type PasteOrderResult = {
  orderedIds: string[];
  matchedIds: string[];
  unmatchedIds: string[];
};

/**
 * Order book sentences by first appearance of each normalized Japanese string
 * inside pasted article text. Unmatched sentences keep prior relative order
 * after all matches.
 *
 * Matching uses {@link normalizeForPasteMatch} (NFKC) so full-width digits and
 * similar compatibility forms align with ASCII forms in Satori page pastes.
 * When an exact substring match fails, we retry with trailing sentence-final
 * punctuation stripped from the stored key — Satori drops the closing 。 on the
 * last sentence of an episode/page, which would otherwise leave it unmatched.
 *
 * When multiple memberships share the same match key, only the first in the
 * given list claims that paste occurrence; later duplicates stay unmatched.
 */
const SENTENCE_TAIL_PUNCTUATION = /[。.!?…‥]+$/;
export function orderBookSentencesFromPaste(
  paste: string,
  sentences: PasteOrderSentence[],
): PasteOrderResult {
  const normalizedPaste = normalizeForPasteMatch(paste);
  if (!normalizedPaste || !sentences.length) {
    const ids = sentences.map((sentence) => sentence.id);
    return { orderedIds: ids, matchedIds: [], unmatchedIds: ids };
  }

  const claimedKeys = new Set<string>();
  const matched: { id: string; index: number; prior: number }[] = [];
  const unmatchedIds: string[] = [];

  sentences.forEach((sentence, prior) => {
    const key = normalizeForPasteMatch(sentence.japanese);
    if (!key) {
      unmatchedIds.push(sentence.id);
      return;
    }
    if (claimedKeys.has(key)) {
      unmatchedIds.push(sentence.id);
      return;
    }
    let index = normalizedPaste.indexOf(key);
    if (index < 0) {
      const trimmedKey = key.replace(SENTENCE_TAIL_PUNCTUATION, '');
      if (trimmedKey && trimmedKey !== key) {
        index = normalizedPaste.indexOf(trimmedKey);
      }
    }
    if (index < 0) {
      unmatchedIds.push(sentence.id);
      return;
    }
    claimedKeys.add(key);
    matched.push({ id: sentence.id, index, prior });
  });

  matched.sort((a, b) => a.index - b.index || a.prior - b.prior);
  const matchedIds = matched.map((item) => item.id);
  return {
    orderedIds: [...matchedIds, ...unmatchedIds],
    matchedIds,
    unmatchedIds,
  };
}
