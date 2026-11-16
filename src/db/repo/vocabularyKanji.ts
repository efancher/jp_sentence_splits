import { deterministicId, createId } from '../../lib/ids';
import type { Kanji, VocabularyItem, VocabularyKanji, VocabularySelection, SentenceVocabulary, StudyItem, SentenceAnalysis, GrammarReviewStatus, ComprehensionCheck, ParticleCheck } from '../../domain/types';
import { getDb } from '../database';
import { nowIso } from '../../lib/normalize';
import { notifySync, notifySyncMany } from '../syncNotify';
import { isHanCharacter } from '../../lib/kanji';
import { conjugationWordClassFromPartOfSpeech, inferConjugationWordClass, conjugationTagFromWordClass } from '../../lib/conjugation';
import { ANALYSIS_FORMAT_VERSION } from '../../appConfig';
import { saveAnalysis } from './sentenceWrites';

// ---------------------------------------------------------------------------
// Vocabulary/kanji relationships (docs/UNIFIED_APP_ARCHITECTURE.md §8, Phase 5).
// VocabularyItem/Kanji are get-or-create, deduped on (expression, reading) and
// character respectively, and never overwritten once created — mirrors
// ensureStudyItem above. SentenceVocabulary links are wholesale-replaced per
// sentence on every confirm, since VocabularySelection[] is itself an
// authoritative snapshot (of the sentence's current picks), not an
// incremental diff.
// ---------------------------------------------------------------------------

/**
 * Id for a get-or-create row (kanji, vocabulary item, grammar pattern and their
 * links): derived from the signed-in owner + natural key so two devices that
 * mint the same word produce the *same* row and the insert converges, instead of
 * two rows with different ids that the server's unique index rejects (the
 * duplicate-key / orphaned-link incidents of 2026-09-19). Signed out there is no
 * owner to scope by (ids are global keys server-side), so it stays random and any
 * duplicate is adopted at push time as before.
 */
export async function mintGetOrCreateId(prefix: string, ...naturalKey: string[]): Promise<string> {
  const { ensureSyncMeta } = await import('../../sync/queue');
  const ownerId = (await ensureSyncMeta()).userId;
  return ownerId ? deterministicId(prefix, ownerId, ...naturalKey) : createId(prefix);
}

export async function ensureKanji(character: string): Promise<Kanji> {
  const db = getDb();
  const existing = await db.kanji.where('character').equals(character).first();
  if (existing) return existing;
  const timestamp = nowIso();
  const kanji: Kanji = {
    id: await mintGetOrCreateId('kanji', character),
    character,
    meanings: [],
    onyomi: [],
    kunyomi: [],
    nanori: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.kanji.put(kanji);
  notifySync('kanji', kanji.id, kanji);
  return kanji;
}

export async function ensureVocabularyItem(
  expression: string,
  reading: string,
  fields: {
    meaning?: string;
    partOfSpeech?: string;
    notes?: string;
    externalId?: string;
  } = {},
): Promise<VocabularyItem> {
  const db = getDb();
  const existing = await db.vocabularyItems
    .where('[expression+reading]')
    .equals([expression, reading])
    .first();
  if (existing) return existing;

  const timestamp = nowIso();
  const item: VocabularyItem = {
    id: await mintGetOrCreateId('vocab_item', expression, reading),
    expression,
    reading,
    meaning: fields.meaning ?? '',
    partOfSpeech: fields.partOfSpeech,
    notes: fields.notes,
    externalId: fields.externalId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  // Kanji rows are get-or-create (shared across every vocabulary item), so
  // resolve them one at a time, in word order, before the item/links commit —
  // matches every occurrence's true position, including repeated kanji
  // (e.g. 主 twice in 民主主義).
  const characters = Array.from(expression);
  const kanjiLinks: VocabularyKanji[] = [];
  for (let position = 0; position < characters.length; position += 1) {
    const character = characters[position];
    if (!isHanCharacter(character)) continue;
    const kanji = await ensureKanji(character);
    kanjiLinks.push({
      id: await mintGetOrCreateId('vocab_kanji', item.id, String(position)),
      vocabularyItemId: item.id,
      kanjiId: kanji.id,
      positionInWord: position,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  await db.transaction(
    'rw',
    db.vocabularyItems,
    db.vocabularyKanji,
    async () => {
      await db.vocabularyItems.put(item);
      for (const link of kanjiLinks) {
        await db.vocabularyKanji.put(link);
      }
    },
  );

  notifySyncMany([
    { entity: 'vocabulary_items', recordId: item.id, payload: item },
    ...kanjiLinks.map((link) => ({
      entity: 'vocabulary_kanji' as const,
      recordId: link.id,
      payload: link,
    })),
  ]);

  return item;
}

export async function updateVocabularyItem(
  itemId: string,
  patch: Partial<Pick<VocabularyItem, 'meaning' | 'partOfSpeech' | 'notes'>>,
): Promise<VocabularyItem> {
  const db = getDb();
  const existing = await db.vocabularyItems.get(itemId);
  if (!existing) throw new Error('Vocabulary item not found');
  const updated: VocabularyItem = {
    ...existing,
    ...patch,
    updatedAt: nowIso(),
  };
  await db.vocabularyItems.put(updated);
  notifySync('vocabulary_items', updated.id, updated);
  return updated;
}

/**
 * Materialize a sentence's confirmed VocabularyPicker selections into real
 * VocabularyItem/SentenceVocabulary rows. Called once, from the confirm
 * action — not on every autosave tick. Wholesale-replaces this sentence's
 * links (add newly-selected, remove deselected); never deletes the
 * VocabularyItem/Kanji rows themselves, since other sentences may reference
 * them.
 */
/**
 * Returns `pos` unchanged when it already names a conjugation word class
 * (JMDict tag, Anki import, the AI glosser's English tag); otherwise, when
 * the word can be inferred to conjugate from its inflected surface / the
 * sentence, returns a synthetic JMDict-style tag (`v5k`, `v1`, `adj-i`…)
 * that `conjugationWordClassFromPartOfSpeech` understands. Falls back to the
 * original `pos` when nothing better is known.
 */
export function upgradeConjugationPos(
  pos: string | undefined,
  expression: string,
  reading: string,
  surfaceForm: string | undefined,
  sentenceJapanese: string | undefined,
): string | undefined {
  if (conjugationWordClassFromPartOfSpeech(pos)) return pos;
  const inferred = inferConjugationWordClass(
    expression,
    reading,
    pos,
    surfaceForm,
    sentenceJapanese,
  );
  return inferred ? conjugationTagFromWordClass(inferred, expression) : pos;
}

export async function materializeVocabularySelections(
  sentenceId: string,
  selections: VocabularySelection[],
): Promise<void> {
  const db = getDb();
  const itemIds = new Set<string>();
  // First selection's surface wins per item id — matters when duplicate
  // selections (same expression/reading, different spans) collapse onto one
  // vocabulary item (see the "collapses duplicate selections" test).
  const surfaceByItemId = new Map<string, string>();
  // Only fetch the sentence text when some selection actually has a POS the
  // conjugation engine can't classify yet — the common "all JMDict tags" /
  // empty-selections paths do no extra work.
  const needsPosUpgrade = selections.some(
    (selection) =>
      selection.expression.trim() && !conjugationWordClassFromPartOfSpeech(selection.pos),
  );
  const sentenceJapanese = needsPosUpgrade
    ? (await db.sentences.get(sentenceId))?.japanese
    : undefined;
  for (const selection of selections) {
    const expression = selection.expression.trim();
    if (!expression) continue;
    const reading = selection.reading.trim();
    const item = await ensureVocabularyItem(expression, reading, {
      meaning: selection.english,
      // Store a conjugation-usable POS tag when the tokenizer only gave a
      // UniDic string ("動詞/一般") the engine can't classify — otherwise the
      // contextual conjugation card can't see this word until a
      // `backfill:vocabulary-jmdict-pos` run. Only upgrades; a POS that
      // already classifies (JMDict tag, Anki import) is passed through, and
      // ensureVocabularyItem never touches an existing row's POS.
      partOfSpeech: upgradeConjugationPos(
        selection.pos,
        expression,
        reading,
        selection.surface,
        sentenceJapanese,
      ),
    });
    itemIds.add(item.id);
    if (!surfaceByItemId.has(item.id)) {
      surfaceByItemId.set(item.id, selection.surface);
    }
  }

  const existingLinks = await db.sentenceVocabulary
    .where('sentenceId')
    .equals(sentenceId)
    .toArray();
  const existingItemIds = new Set(
    existingLinks.map((link) => link.vocabularyItemId),
  );

  const toDelete = existingLinks.filter(
    (link) => !itemIds.has(link.vocabularyItemId),
  );
  const timestamp = nowIso();
  const toCreate: SentenceVocabulary[] = [...itemIds]
    .filter((itemId) => !existingItemIds.has(itemId))
    .map((itemId) => ({
      id: createId('sentence_vocab'),
      sentenceId,
      vocabularyItemId: itemId,
      surfaceForm: surfaceByItemId.get(itemId),
      createdAt: timestamp,
      updatedAt: timestamp,
    }));

  // Per-occurrence cards (word_listening, pitch_accent, …) key off a
  // SentenceVocabulary.id as their StudyItem.subjectId — a link going away
  // (a word un-confirmed on an already-confirmed sentence, not just the
  // whole sentence being deleted) would otherwise leave that study item
  // stuck-due forever, same failure `cascadeRetireSentenceLocal` was built
  // to close for whole-sentence deletes (2026-09-02, ~20 found orphaned).
  const orphanedStudyItems: StudyItem[] = [];
  for (const link of toDelete) {
    const items = await db.studyItems.where('subjectId').equals(link.id).toArray();
    orphanedStudyItems.push(
      ...items.filter((item) => item.subjectType === 'sentenceVocabulary'),
    );
  }

  await db.transaction('rw', db.sentenceVocabulary, db.studyItems, async () => {
    for (const link of toDelete) {
      await db.sentenceVocabulary.delete(link.id);
    }
    for (const item of orphanedStudyItems) {
      await db.studyItems.delete(item.id);
    }
    for (const link of toCreate) {
      await db.sentenceVocabulary.put(link);
    }
  });

  notifySyncMany([
    ...toDelete.map((link) => ({
      entity: 'sentence_vocabulary' as const,
      recordId: link.id,
      payload: link,
      operation: 'delete' as const,
    })),
    ...orphanedStudyItems.map((item) => ({
      entity: 'study_items' as const,
      recordId: item.id,
      payload: { id: item.id },
      operation: 'delete' as const,
    })),
    ...toCreate.map((link) => ({
      entity: 'sentence_vocabulary' as const,
      recordId: link.id,
      payload: link,
    })),
  ]);
}

/**
 * Centralizes the VocabularyPicker confirm write path (VocabularyReviewPage):
 * flips vocabularyReviewStatus to 'confirmed' and materializes selections into
 * real VocabularyItem/SentenceVocabulary rows — without touching this
 * sentence's structural (chunk/notes) analysis state, which this function has
 * no input for and simply passes through unchanged from the existing row.
 *
 * Deliberately does NOT settle or advance any session step: session steps are
 * settled only by an explicit "Mark complete"/"Skip" (SessionBar /
 * SessionRunnerPage), so there's one predictable advance control and no
 * chance of a confirm here quietly moving the session's pointer past work the
 * learner hasn't done (2026-08-27 decision — reverts the 2026-08-22
 * auto-settle).
 */
export async function confirmSentenceVocabulary(
  sentenceId: string,
  selections: VocabularySelection[],
): Promise<SentenceAnalysis> {
  const db = getDb();
  const existing = await db.analyses.get(sentenceId);
  const analysis = await saveAnalysis(sentenceId, existing?.chunks ?? [], existing?.notes ?? '', {
    reviewStatus: 'confirmed',
    selections,
  });
  await materializeVocabularySelections(sentenceId, selections);
  return analysis;
}

/**
 * Grammar analogue of confirmSentenceVocabulary: flips `grammarReviewStatus`
 * without touching structural or vocabulary state. `confirmed` means the
 * learner has been through the sentence's "Grammar noticed" panel and is
 * done with it — patterns worth tracking are tracked, or there was nothing
 * more to pull out — which is what drops the sentence from the planner's
 * `grammar_noticing` nudge. Pass `status: 'unreviewed'` to undo a misclick.
 * Like confirmSentenceVocabulary, it never settles or advances a session
 * step.
 */
export async function setSentenceGrammarReviewStatus(
  sentenceId: string,
  status: GrammarReviewStatus,
): Promise<SentenceAnalysis> {
  const db = getDb();
  const existing = await db.analyses.get(sentenceId);
  return saveAnalysis(sentenceId, existing?.chunks ?? [], existing?.notes ?? '', undefined, {
    reviewStatus: status,
  });
}

/**
 * Save/clear the authored comprehension-check options for `reading_in_context`
 * (`src/lib/comprehensionCheck.ts`). A narrow direct update, same precedent as
 * `setSentenceGrammarReviewStatus` avoiding a full `saveAnalysis` round-trip —
 * except here there's no chunk data to round-trip through at all, so this
 * writes the `analyses` row directly (seeding a minimal one if the sentence
 * has never been opened in AnalyzePage before).
 */
export async function setSentenceComprehensionCheck(
  sentenceId: string,
  check: ComprehensionCheck | undefined,
): Promise<void> {
  const db = getDb();
  const existing = await db.analyses.get(sentenceId);
  const timestamp = nowIso();
  if (!existing) {
    await db.analyses.put({
      sentenceId,
      chunks: [],
      notes: '',
      status: 'empty',
      formatVersion: ANALYSIS_FORMAT_VERSION,
      vocabularyReviewStatus: 'unreviewed',
      vocabularySelections: [],
      grammarSuggestions: [],
      grammarReviewStatus: 'unreviewed',
      comprehensionCheck: check,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    notifySync('analyses', sentenceId, (await db.analyses.get(sentenceId))!);
    return;
  }
  await db.analyses.update(sentenceId, { comprehensionCheck: check, updatedAt: timestamp });
  notifySync('analyses', sentenceId, (await db.analyses.get(sentenceId))!);
}

/** Save the authored contextual particle questions (`[]` = checked, nothing to ask). */
export async function setSentenceParticleChecks(
  sentenceId: string,
  checks: ParticleCheck[] | undefined,
): Promise<void> {
  const db = getDb();
  const existing = await db.analyses.get(sentenceId);
  const timestamp = nowIso();
  if (!existing) {
    await db.analyses.put({
      sentenceId,
      chunks: [],
      notes: '',
      status: 'empty',
      formatVersion: ANALYSIS_FORMAT_VERSION,
      vocabularyReviewStatus: 'unreviewed',
      vocabularySelections: [],
      grammarSuggestions: [],
      grammarReviewStatus: 'unreviewed',
      particleChecks: checks,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    notifySync('analyses', sentenceId, (await db.analyses.get(sentenceId))!);
    return;
  }
  await db.analyses.update(sentenceId, { particleChecks: checks, updatedAt: timestamp });
  notifySync('analyses', sentenceId, (await db.analyses.get(sentenceId))!);
}
