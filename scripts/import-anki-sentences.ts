/**
 * One-time import of Anki immersion notes (exported by
 * ~/projects/anki/scripts/export_immersion_notes_for_glossbook.py) into
 * Sentence / vocabulary_items / sentence_vocabulary / inbox.
 *
 * Dry-run by default — prints counts and writes nothing. Pass --apply to
 * actually write. Idempotent: re-running with --apply against unchanged
 * input reports zero new/changed.
 *
 * Usage: npm run import:anki-sentences -- <export.json> [--apply]
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import type { ImportBatch, InboxMembership, Sentence, SourceReference, TargetVocabulary } from '../src/domain/types';
import { sentenceSchema, vocabularyItemSchema } from '../src/domain/schemas';
import { createId, sentenceIdFromNormalizedKey } from '../src/lib/ids';
import { normalizeExpressionKey, nowIso } from '../src/lib/normalize';
import { importBatchToRemote, inboxToRemote, sentenceToRemote } from '../src/sync/mappers';

import { sentenceDraftFromNote, vocabularyItemFromNote, type AnkiNoteExport } from './lib/ankiImport';
import { fetchAll, upsertBatched, withoutVersionAndTimestamps } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

function mergeSourceReferences(existing: SourceReference[], incoming: SourceReference): SourceReference[] {
  const byCardId = new Map(existing.map((ref) => [ref.cardId, ref]));
  byCardId.set(incoming.cardId, incoming);
  return [...byCardId.values()];
}

function mergeTargetVocabulary(existing: TargetVocabulary[], incoming: TargetVocabulary): TargetVocabulary[] {
  const key = (v: TargetVocabulary) => `${v.expression}|${v.reading}`;
  const byKey = new Map(existing.map((v) => [key(v), v]));
  const prev = byKey.get(key(incoming));
  byKey.set(key(incoming), {
    ...incoming,
    english: prev?.english || incoming.english,
    furigana: prev?.furigana || incoming.furigana,
    partsOfSpeech: prev?.partsOfSpeech || incoming.partsOfSpeech,
    sourceCardIds: [...new Set([...(prev?.sourceCardIds ?? []), ...incoming.sourceCardIds])],
    cardTypes: [...new Set([...(prev?.cardTypes ?? []), ...incoming.cardTypes])],
  });
  return [...byKey.values()];
}

interface WorkingSentence {
  id: string;
  normalizedKey: string;
  isNew: boolean;
  japanese: string;
  readingOnly: string;
  inlineReading: string;
  translation: string;
  targetVocabulary: TargetVocabulary[];
  sourceReferences: SourceReference[];
  importBatchIds: string[];
  firstOccurrenceIndex: number;
}

interface WorkingVocabItem {
  id: string;
  expression: string;
  reading: string;
  meaning: string;
  partOfSpeech?: string;
  isNew: boolean;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const inputPath = args.find((arg) => !arg.startsWith('--'));
  if (!inputPath) {
    console.error('Usage: npm run import:anki-sentences -- <export.json> [--apply]');
    process.exitCode = 1;
    return;
  }

  const notes = JSON.parse(await readFile(inputPath, 'utf8')) as AnkiNoteExport[];
  console.log(`Read ${notes.length} notes from ${inputPath}.`);

  const supabase = await createScriptSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Signed in but no user on session — unexpected.');

  const [existingSentences, existingVocabItems, existingLinks, existingInbox] = await Promise.all([
    fetchAll(
      supabase,
      'sentences',
      'id, normalized_key, japanese, reading_only, inline_reading, translation, target_vocabulary, source_references, import_batch_ids, first_occurrence_index',
      user.id,
      (row) => ({
        id: String(row.id),
        normalizedKey: String(row.normalized_key),
        japanese: String(row.japanese),
        readingOnly: String(row.reading_only),
        inlineReading: String(row.inline_reading),
        translation: String(row.translation),
        targetVocabulary: (row.target_vocabulary as TargetVocabulary[]) ?? [],
        sourceReferences: (row.source_references as SourceReference[]) ?? [],
        importBatchIds: (row.import_batch_ids as string[]) ?? [],
        firstOccurrenceIndex: Number(row.first_occurrence_index ?? 0),
      }),
    ),
    fetchAll(supabase, 'vocabulary_items', 'id, expression, reading, meaning, part_of_speech', user.id, (row) => ({
      id: String(row.id),
      expression: String(row.expression),
      reading: String(row.reading),
      meaning: String(row.meaning ?? ''),
      partOfSpeech: row.part_of_speech ? String(row.part_of_speech) : undefined,
    })),
    fetchAll(supabase, 'sentence_vocabulary', 'sentence_id, vocabulary_item_id', user.id, (row) => ({
      sentenceId: String(row.sentence_id),
      vocabularyItemId: String(row.vocabulary_item_id),
    })),
    fetchAll(
      supabase,
      'inbox',
      'sentence_id',
      user.id,
      (row) => String(row.sentence_id),
      'sentence_id', // inbox has no `id` column — primary key is (owner_id, sentence_id)
    ),
  ]);

  const sentencesByKey = new Map(existingSentences.map((s) => [s.normalizedKey, s]));
  const vocabByKey = new Map(existingVocabItems.map((v) => [normalizeExpressionKey(v.expression, v.reading), v]));
  const linkKeys = new Set(existingLinks.map((l) => `${l.sentenceId}|${l.vocabularyItemId}`));
  const inboxKeys = new Set(existingInbox);

  const now = nowIso();
  const importBatch: ImportBatch = {
    id: createId('batch'),
    filename: basename(inputPath),
    batchName: `Anki immersion import (${basename(inputPath)})`,
    importedAt: now,
    counts: {
      totalRows: notes.length,
      contextOccurrences: notes.length,
      uniqueSentences: 0,
      newSentences: 0,
      updatedSentences: 0,
      exactDuplicatesIgnored: 0,
      newVocabularyAssociations: 0,
      rowsSkipped: 0,
      warningCount: 0,
      conflictCount: 0,
    },
    warnings: [],
  };

  const workingSentences = new Map<string, WorkingSentence>();
  const workingVocab = new Map<string, WorkingVocabItem>();
  const newInboxSentenceIds = new Set<string>();
  const newLinkKeys = new Set<string>();
  let notesSkippedNoSentence = 0;

  notes.forEach((note, index) => {
    const draft = sentenceDraftFromNote(note, importBatch.id);
    if (!draft) {
      notesSkippedNoSentence += 1;
      return;
    }

    let working = workingSentences.get(draft.normalizedKey);
    if (!working) {
      const existing = sentencesByKey.get(draft.normalizedKey);
      // firstOccurrenceIndex is preserved on merge, never overwritten with
      // this run's note index — it's a stable position used for
      // first-occurrence sort order (matches mergeSentenceOnReimport's
      // behavior in src/lib/csvImport.ts, the existing importer's own
      // reimport path).
      working = existing
        ? { ...existing, normalizedKey: draft.normalizedKey, isNew: false }
        : {
            id: sentenceIdFromNormalizedKey(draft.normalizedKey),
            normalizedKey: draft.normalizedKey,
            isNew: true,
            japanese: '',
            readingOnly: '',
            inlineReading: '',
            translation: '',
            targetVocabulary: [],
            sourceReferences: [],
            importBatchIds: [],
            firstOccurrenceIndex: index,
          };
      workingSentences.set(draft.normalizedKey, working);
      if (!inboxKeys.has(working.id)) newInboxSentenceIds.add(working.id);
    }

    const [incomingSourceRef] = draft.sourceReferences;
    working.sourceReferences = mergeSourceReferences(working.sourceReferences, incomingSourceRef);
    if (draft.targetVocabulary.length) {
      working.targetVocabulary = mergeTargetVocabulary(working.targetVocabulary, draft.targetVocabulary[0]);
    }
    working.importBatchIds = [...new Set([...working.importBatchIds, importBatch.id])];
    working.japanese ||= draft.japanese;
    working.readingOnly ||= draft.readingOnly;
    working.inlineReading ||= draft.inlineReading;
    working.translation ||= draft.translation;

    const vocabDraft = vocabularyItemFromNote(note);
    if (vocabDraft) {
      const vocabKey = normalizeExpressionKey(vocabDraft.expression, vocabDraft.reading);
      let vocabItem = workingVocab.get(vocabKey);
      if (!vocabItem) {
        const existingVocab = vocabByKey.get(vocabKey);
        vocabItem = existingVocab ? { ...existingVocab, isNew: false } : { ...vocabDraft, id: createId('vocab'), isNew: true };
        workingVocab.set(vocabKey, vocabItem);
      }
      if (!vocabItem.meaning && vocabDraft.meaning) vocabItem.meaning = vocabDraft.meaning;
      if (!vocabItem.partOfSpeech && vocabDraft.partOfSpeech) vocabItem.partOfSpeech = vocabDraft.partOfSpeech;

      const linkKey = `${working.id}|${vocabItem.id}`;
      if (!linkKeys.has(linkKey)) {
        linkKeys.add(linkKey);
        newLinkKeys.add(linkKey);
      }
    }
  });

  const newSentenceCount = [...workingSentences.values()].filter((s) => s.isNew).length;
  const updatedSentenceCount = workingSentences.size - newSentenceCount;
  const newVocabCount = [...workingVocab.values()].filter((v) => v.isNew).length;

  importBatch.counts.uniqueSentences = workingSentences.size;
  importBatch.counts.newSentences = newSentenceCount;
  importBatch.counts.updatedSentences = updatedSentenceCount;
  importBatch.counts.newVocabularyAssociations = newLinkKeys.size;
  importBatch.counts.rowsSkipped = notesSkippedNoSentence;

  console.log('--- Summary ---');
  console.log(`New sentences:        ${newSentenceCount}`);
  console.log(`Updated sentences:    ${updatedSentenceCount}`);
  console.log(`New vocabulary items: ${newVocabCount}`);
  console.log(`New sentence links:   ${newLinkKeys.size}`);
  console.log(`New inbox entries:    ${newInboxSentenceIds.size}`);
  console.log(`Notes skipped (no Sentence field): ${notesSkippedNoSentence}`);

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
    return;
  }

  const sentenceRows = [...workingSentences.values()].map((working) => {
    const sentence: Sentence = sentenceSchema.parse({
      id: working.id,
      normalizedKey: working.normalizedKey,
      japanese: working.japanese,
      readingOnly: working.readingOnly,
      inlineReading: working.inlineReading,
      translation: working.translation,
      targetVocabulary: working.targetVocabulary,
      vocabularySuggestions: [],
      sourceReferences: working.sourceReferences,
      conflicts: [],
      firstOccurrenceIndex: working.firstOccurrenceIndex,
      importBatchIds: working.importBatchIds,
      createdAt: now,
      updatedAt: now,
    });
    return withoutVersionAndTimestamps(sentenceToRemote(sentence, user.id, 1));
  });

  const vocabRows = [...workingVocab.values()].map((v) => {
    const parsed = vocabularyItemSchema.parse({
      id: v.id,
      expression: v.expression,
      reading: v.reading,
      meaning: v.meaning,
      partOfSpeech: v.partOfSpeech,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id: parsed.id,
      owner_id: user.id,
      expression: parsed.expression,
      reading: parsed.reading,
      meaning: parsed.meaning,
      part_of_speech: parsed.partOfSpeech ?? null,
    };
  });

  const linkRows = [...newLinkKeys].map((key) => {
    const [sentenceId, vocabularyItemId] = key.split('|');
    return {
      id: createId('sv'),
      owner_id: user.id,
      sentence_id: sentenceId,
      vocabulary_item_id: vocabularyItemId,
      chunk_id: null,
    };
  });

  const inboxRows: InboxMembership[] = [...newInboxSentenceIds].map((sentenceId) => ({
    sentenceId,
    importBatchId: importBatch.id,
    addedAt: now,
  }));

  await upsertBatched(supabase, 'sentences', sentenceRows, 'id');
  await upsertBatched(supabase, 'vocabulary_items', vocabRows, 'id');
  await upsertBatched(supabase, 'sentence_vocabulary', linkRows, 'id');
  await upsertBatched(
    supabase,
    'inbox',
    inboxRows.map((row) => withoutVersionAndTimestamps(inboxToRemote(row, user.id, 1))),
    'owner_id,sentence_id',
  );
  const { error: batchError } = await supabase
    .from('import_batches')
    .insert(withoutVersionAndTimestamps(importBatchToRemote(importBatch, user.id, 1)));
  if (batchError) throw new Error(`Insert into import_batches failed: ${batchError.message}`);

  console.log('\nApplied.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
