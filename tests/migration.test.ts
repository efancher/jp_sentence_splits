import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';

import { GlossbookDatabase, readSettings } from '../src/db/database';
import { createId } from '../src/lib/ids';

describe('Dexie schema migrations', () => {
  it('opens at the current schema version and seeds settings', async () => {
    const name = `migrate-${createId('db')}`;
    const db = new GlossbookDatabase(name);
    await db.open();
    expect(db.verno).toBeGreaterThanOrEqual(4);
    expect(db.tables.some((table) => table.name === 'sentenceAudio')).toBe(true);
    const settings = await readSettings(db);
    expect(settings.id).toBe('settings');
    expect(settings.theme).toBe('system');
    db.close();
    await indexedDB.deleteDatabase(name);
  });

  it('opens at schema v6 with the unified study model tables', async () => {
    const name = `migrate-v6-${createId('db')}`;
    const db = new GlossbookDatabase(name);
    await db.open();
    expect(db.verno).toBeGreaterThanOrEqual(6);
    for (const table of [
      'sources',
      'vocabularyItems',
      'sentenceVocabulary',
      'kanji',
      'vocabularyKanji',
      'studyItems',
      'reviews',
    ]) {
      expect(db.tables.some((t) => t.name === table)).toBe(true);
    }

    const now = new Date().toISOString();
    await db.kanji.put({
      id: 'kanji-1',
      character: '生',
      meanings: ['life', 'birth'],
      onyomi: ['セイ', 'ショウ'],
      kunyomi: ['い.きる', 'う.まれる'],
      nanori: [],
      createdAt: now,
      updatedAt: now,
    });
    await db.vocabularyItems.put({
      id: 'vocab-1',
      expression: '先生',
      reading: 'せんせい',
      meaning: 'teacher',
      createdAt: now,
      updatedAt: now,
    });
    await db.vocabularyKanji.put({
      id: 'vk-1',
      vocabularyItemId: 'vocab-1',
      kanjiId: 'kanji-1',
      positionInWord: 0,
      createdAt: now,
      updatedAt: now,
    });
    await db.studyItems.put({
      id: 'si-1',
      subjectType: 'vocabularyItem',
      subjectId: 'vocab-1',
      activityType: 'vocab_in_context',
      fsrsState: {
        due: now,
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        learningSteps: 0,
        reps: 0,
        lapses: 0,
        state: 'new',
      },
      createdAt: now,
      updatedAt: now,
    });
    await db.reviews.put({
      id: 'rev-1',
      studyItemId: 'si-1',
      timestamp: now,
      rating: 'good',
    });

    const link = await db.vocabularyKanji.get('vk-1');
    expect(link?.kanjiId).toBe('kanji-1');
    const review = await db.reviews.get('rev-1');
    expect(review?.rating).toBe('good');

    db.close();
    await indexedDB.deleteDatabase(name);
  });

  it('opens at schema v7 with the attempts table', async () => {
    const name = `migrate-v7-${createId('db')}`;
    const db = new GlossbookDatabase(name);
    await db.open();
    expect(db.verno).toBeGreaterThanOrEqual(7);
    expect(db.tables.some((t) => t.name === 'attempts')).toBe(true);

    const now = new Date().toISOString();
    await db.attempts.put({
      id: 'attempt-1',
      sentenceId: 'sent-1',
      mimeType: 'audio/webm',
      durationMs: 2500,
      blob: new Blob(['fake audio bytes'], { type: 'audio/webm' }),
      createdAt: now,
    });

    const attempt = await db.attempts.get('attempt-1');
    expect(attempt?.sentenceId).toBe('sent-1');
    // fake-indexeddb/jsdom does not structured-clone Blob internals, but the
    // record and MIME metadata still prove the blob was stored (see the same
    // caveat in tests/shadowingImport.test.ts).
    expect(attempt?.mimeType).toBe('audio/webm');
    expect(attempt?.blob).toBeTruthy();

    db.close();
    await indexedDB.deleteDatabase(name);
  });

  it('opens at schema v8 with the vocabularyConfusions table', async () => {
    const name = `migrate-v8-${createId('db')}`;
    const db = new GlossbookDatabase(name);
    await db.open();
    expect(db.verno).toBeGreaterThanOrEqual(8);
    expect(db.tables.some((t) => t.name === 'vocabularyConfusions')).toBe(true);

    const now = new Date().toISOString();
    await db.vocabularyConfusions.put({
      id: 'confusion-1',
      itemAId: 'vocab-a',
      itemBId: 'vocab-b',
      confusionType: 'transitivity',
      observedCount: 1,
      lastObservedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.reviews.put({
      id: 'rev-2',
      studyItemId: 'si-1',
      timestamp: now,
      rating: 'again',
      assistance: ['furigana_shown'],
      source: 'natural_encounter',
      contextSentenceId: 'sent-9',
    });

    const confusion = await db.vocabularyConfusions.get('confusion-1');
    expect(confusion?.confusionType).toBe('transitivity');
    const review = await db.reviews.get('rev-2');
    expect(review?.source).toBe('natural_encounter');
    expect(review?.assistance).toEqual(['furigana_shown']);

    db.close();
    await indexedDB.deleteDatabase(name);
  });

  it('opens at schema v9 with the referenceAlignments/attemptAlignments tables', async () => {
    const name = `migrate-v9-${createId('db')}`;
    const db = new GlossbookDatabase(name);
    await db.open();
    expect(db.verno).toBeGreaterThanOrEqual(9);
    expect(db.tables.some((t) => t.name === 'referenceAlignments')).toBe(true);
    expect(db.tables.some((t) => t.name === 'attemptAlignments')).toBe(true);

    const now = new Date().toISOString();
    const result = {
      durationSeconds: 1.7,
      words: [{ start: 0.5, end: 0.84, text: 'ちょっと', phones: [] }],
    };
    await db.referenceAlignments.put({
      id: 'audio-1',
      alignmentVersion: 1,
      result,
      computedAt: now,
    });
    await db.attemptAlignments.put({
      id: 'attempt-1',
      alignmentVersion: 1,
      result,
      computedAt: now,
    });

    expect((await db.referenceAlignments.get('audio-1'))?.result.words[0]?.text).toBe(
      'ちょっと',
    );
    expect((await db.attemptAlignments.get('attempt-1'))?.alignmentVersion).toBe(1);

    db.close();
    await indexedDB.deleteDatabase(name);
  });

  it('adds empty chapter collections to books from schema v2', async () => {
    const name = `migrate-v2-${createId('db')}`;
    const legacy = new Dexie(name);
    legacy.version(2).stores({
      books: 'id, title, archived, updatedAt, lastOpenedAt',
    });
    await legacy.open();
    await legacy.table('books').put({
      id: 'legacy-book',
      title: 'Legacy',
      archived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    legacy.close();

    const migrated = new GlossbookDatabase(name);
    await migrated.open();
    expect((await migrated.books.get('legacy-book'))?.chapters).toEqual([]);
    migrated.close();
    await indexedDB.deleteDatabase(name);
  });
});
