import type { SourceReference, TargetVocabulary } from '../../src/domain/types';
import { displayJapanese, normalizeSentenceKey } from '../../src/lib/normalize';

export interface AnkiNoteExport {
  noteType: string;
  duplicateKey: string;
  fields: Record<string, string>;
}

export interface SentenceDraftFromAnki {
  normalizedKey: string;
  japanese: string;
  readingOnly: string;
  inlineReading: string;
  translation: string;
  targetVocabulary: TargetVocabulary[];
  sourceReferences: SourceReference[];
}

export interface VocabularyItemDraft {
  expression: string;
  reading: string;
  meaning: string;
  partOfSpeech?: string;
}

// `Glossary` turns out not to be a gloss field at all (verified against a
// real export): for Satori/Shadowing Immersion it holds real JMDict POS
// tags ("adj-i", "v5k; vi"), but for Shadowing Immersion specifically it's
// always the literal marker "auto-caption", and for Shadowing Candidate
// it's a "POS: <label>" placeholder ("POS: unknown", "POS: colloquial-
// compound") from the candidate pipeline, not a linguistic tag. Only the
// first case is worth keeping as partOfSpeech.
const JUNK_GLOSSARY_VALUES = new Set(['auto-caption']);

function isRealPosTag(glossary: string): boolean {
  return glossary.length > 0 && !JUNK_GLOSSARY_VALUES.has(glossary) && !glossary.startsWith('POS: ');
}

/**
 * WkMeaning is the word's real English meaning when present; HintGlossary
 * is its JMDict-hit fallback for candidates. Glossary is never a gloss (see
 * above). Anki fields are stored as HTML, so this needs the same
 * entity-decoding displayJapanese already applies to Expression/Reading/
 * Translation — WkMeaning/HintGlossary were the one field left raw, which
 * left apostrophes as literal `&#x27;` in stored meanings (found live,
 * fixed here; scripts/fix-html-entity-meanings.ts corrects already-imported
 * rows).
 */
export function vocabularyMeaning(fields: Record<string, string>): string {
  return displayJapanese(fields.WkMeaning || fields.HintGlossary || '');
}

export function vocabularyPartOfSpeech(fields: Record<string, string>): string | undefined {
  const glossary = (fields.Glossary || '').trim();
  return isRealPosTag(glossary) ? glossary : undefined;
}

export function vocabularyItemFromNote(note: AnkiNoteExport): VocabularyItemDraft | null {
  const expression = displayJapanese(note.fields.Expression || '');
  if (!expression) return null;
  return {
    expression,
    reading: displayJapanese(note.fields.Reading || ''),
    meaning: vocabularyMeaning(note.fields),
    partOfSpeech: vocabularyPartOfSpeech(note.fields),
  };
}

function sourceUserNotes(fields: Record<string, string>): string | undefined {
  const title = (fields.SourceTitle || '').trim();
  const url = (fields.SourceUrl || '').trim();
  if (!title && !url) return undefined;
  if (title && url) return `Source: ${title} (${url})`;
  return `Source: ${title || url}`;
}

/** Maps one Anki note into a Sentence draft. Returns null when the note has no Sentence text to import. */
export function sentenceDraftFromNote(note: AnkiNoteExport, importBatchId: string): SentenceDraftFromAnki | null {
  const japanese = displayJapanese(note.fields.Sentence || '');
  const normalizedKey = normalizeSentenceKey(japanese);
  if (!normalizedKey) return null;

  const expression = displayJapanese(note.fields.Expression || '');
  const targetVocabulary: TargetVocabulary[] = expression
    ? [
        {
          expression,
          reading: displayJapanese(note.fields.Reading || ''),
          furigana: displayJapanese(note.fields.Furigana || ''),
          english: vocabularyMeaning(note.fields),
          partsOfSpeech: vocabularyPartOfSpeech(note.fields) ?? '',
          sourceCardIds: [note.duplicateKey],
          cardTypes: [note.noteType],
        },
      ]
    : [];

  const userNotes = sourceUserNotes(note.fields);
  const sourceReference: SourceReference = {
    cardId: note.duplicateKey,
    cardType: note.noteType,
    contextNumber: 1,
    importBatchId,
    ...(userNotes ? { userNotes } : {}),
  };

  return {
    normalizedKey,
    japanese,
    readingOnly: displayJapanese(note.fields.SentenceKana || ''),
    inlineReading: displayJapanese(note.fields.SentenceFurigana || ''),
    translation: displayJapanese(note.fields.Translation || ''),
    targetVocabulary,
    sourceReferences: [sourceReference],
  };
}
