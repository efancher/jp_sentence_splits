import { describe, expect, it } from 'vitest';

import {
  sentenceDraftFromNote,
  vocabularyItemFromNote,
  vocabularyMeaning,
  vocabularyPartOfSpeech,
  type AnkiNoteExport,
} from '../scripts/lib/ankiImport';

function note(fields: Record<string, string>, overrides: Partial<AnkiNoteExport> = {}): AnkiNoteExport {
  return {
    noteType: 'WK Satori Immersion',
    duplicateKey: 'dup-1',
    fields: {
      DuplicateKey: 'dup-1',
      Expression: '青い',
      Reading: 'あおい',
      Translation: 'The sky was blue.',
      Sentence: '空は青い。',
      SentenceFurigana: '',
      SentenceKana: '',
      SourceTitle: '',
      SourceUrl: '',
      WkMeaning: '',
      Glossary: '',
      HintGlossary: '',
      Furigana: '',
      ...fields,
    },
    ...overrides,
  };
}

describe('vocabularyMeaning', () => {
  it('prefers WkMeaning', () => {
    expect(vocabularyMeaning({ WkMeaning: 'Blue', HintGlossary: 'azure' })).toBe('Blue');
  });

  it('falls back to HintGlossary when WkMeaning is empty', () => {
    expect(vocabularyMeaning({ WkMeaning: '', HintGlossary: 'azure' })).toBe('azure');
  });

  it('is empty when neither is present', () => {
    expect(vocabularyMeaning({})).toBe('');
  });
});

describe('vocabularyPartOfSpeech', () => {
  it('keeps a real JMDict-style tag', () => {
    expect(vocabularyPartOfSpeech({ Glossary: 'adj-i' })).toBe('adj-i');
    expect(vocabularyPartOfSpeech({ Glossary: 'v5k; vi' })).toBe('v5k; vi');
  });

  it('drops the "auto-caption" marker (Shadowing Immersion junk value)', () => {
    expect(vocabularyPartOfSpeech({ Glossary: 'auto-caption' })).toBeUndefined();
  });

  it('drops "POS: ..." placeholders (Shadowing Candidate pipeline junk)', () => {
    expect(vocabularyPartOfSpeech({ Glossary: 'POS: unknown' })).toBeUndefined();
    expect(vocabularyPartOfSpeech({ Glossary: 'POS: colloquial-compound' })).toBeUndefined();
  });

  it('is undefined when empty', () => {
    expect(vocabularyPartOfSpeech({})).toBeUndefined();
  });
});

describe('vocabularyItemFromNote', () => {
  it('maps expression/reading/meaning/partOfSpeech', () => {
    expect(vocabularyItemFromNote(note({ Glossary: 'adj-i', WkMeaning: 'Blue' }))).toEqual({
      expression: '青い',
      reading: 'あおい',
      meaning: 'Blue',
      partOfSpeech: 'adj-i',
    });
  });

  it('returns null when Expression is missing', () => {
    expect(vocabularyItemFromNote(note({ Expression: '' }))).toBeNull();
  });

  it('matches the real Shadowing Candidate shape: no meaning, no partOfSpeech', () => {
    const candidate = note(
      { Glossary: 'POS: unknown', WkMeaning: '', HintGlossary: '' },
      { noteType: 'WK Shadowing Candidate' },
    );
    expect(vocabularyItemFromNote(candidate)).toEqual({
      expression: '青い',
      reading: 'あおい',
      meaning: '',
      partOfSpeech: undefined,
    });
  });
});

describe('sentenceDraftFromNote', () => {
  it('maps Sentence/Translation/SentenceFurigana/SentenceKana', () => {
    const draft = sentenceDraftFromNote(
      note({
        Sentence: '空は青い。',
        Translation: 'The sky is blue.',
        SentenceFurigana: '空[そら]は 青[あお]い。',
        SentenceKana: 'そらはあおい。',
      }),
      'batch-1',
    );
    expect(draft?.japanese).toBe('空は青い。');
    expect(draft?.translation).toBe('The sky is blue.');
    expect(draft?.inlineReading).toBe('空[そら]は 青[あお]い。');
    expect(draft?.readingOnly).toBe('そらはあおい。');
    expect(draft?.normalizedKey).toBe('空は青い。');
  });

  it('returns null when Sentence is missing or blank', () => {
    expect(sentenceDraftFromNote(note({ Sentence: '' }), 'batch-1')).toBeNull();
    expect(sentenceDraftFromNote(note({ Sentence: '   ' }), 'batch-1')).toBeNull();
  });

  it('builds a single targetVocabulary entry from Expression/Reading/Furigana', () => {
    const draft = sentenceDraftFromNote(note({ Furigana: '青[あお]い', WkMeaning: 'Blue' }), 'batch-1');
    expect(draft?.targetVocabulary).toEqual([
      {
        expression: '青い',
        reading: 'あおい',
        furigana: '青[あお]い',
        english: 'Blue',
        partsOfSpeech: '',
        sourceCardIds: ['dup-1'],
        cardTypes: ['WK Satori Immersion'],
      },
    ]);
  });

  it('leaves targetVocabulary empty when Expression is missing', () => {
    const draft = sentenceDraftFromNote(note({ Expression: '' }), 'batch-1');
    expect(draft?.targetVocabulary).toEqual([]);
  });

  it('includes a userNotes source summary only when SourceTitle/SourceUrl are present', () => {
    const withSource = sentenceDraftFromNote(
      note({ SourceTitle: 'After Work', SourceUrl: 'https://youtu.be/x' }),
      'batch-1',
    );
    expect(withSource?.sourceReferences[0].userNotes).toBe('Source: After Work (https://youtu.be/x)');

    const withoutSource = sentenceDraftFromNote(note({ SourceTitle: '', SourceUrl: '' }), 'batch-1');
    expect(withoutSource?.sourceReferences[0].userNotes).toBeUndefined();
  });

  it('sets sourceReferences cardId/cardType/importBatchId from the note', () => {
    const draft = sentenceDraftFromNote(note({}, { noteType: 'WK Shadowing Immersion', duplicateKey: 'dup-42' }), 'batch-9');
    expect(draft?.sourceReferences).toEqual([
      { cardId: 'dup-42', cardType: 'WK Shadowing Immersion', contextNumber: 1, importBatchId: 'batch-9' },
    ]);
  });
});
