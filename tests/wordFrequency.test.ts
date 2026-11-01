import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  ensureStudyItem,
  ensureVocabularyItem,
  getDb,
  getWeakWordRecallTarget,
} from '../src/db/repository';
import type { Review, Sentence, SentenceVocabulary } from '../src/domain/types';
import { createId } from '../src/lib/ids';
import { loadWordFrequency, lookupWordBand, resetWordFrequencyCache } from '../src/lib/wordFrequency';

describe('lookupWordBand', () => {
  const data = { 日本: 2, 日: { ひ: 1, にち: 6 }, 猫: 12 };

  it('reads a single band', () => {
    expect(lookupWordBand(data, '日本', 'にほん')).toBe(2);
    expect(lookupWordBand(data, '猫')).toBe(12);
  });

  it('keeps homograph readings apart, and falls back to the most frequent reading', () => {
    expect(lookupWordBand(data, '日', 'にち')).toBe(6);
    expect(lookupWordBand(data, '日', 'じつ')).toBe(1);
    expect(lookupWordBand(data, '日')).toBe(1);
  });

  it('has no band for an untagged word', () => {
    expect(lookupWordBand(data, '草むら', 'くさむら')).toBeNull();
  });
});

describe('loadWordFrequency', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetWordFrequencyCache();
  });

  it('degrades to no prior when the file cannot be fetched, and retries next time', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await loadWordFrequency()).toEqual({});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ 本: 3 }) }));
    expect(await loadWordFrequency()).toEqual({ 本: 3 });
  });
});

describe('the frequency prior in the app', () => {
  beforeEach(() => {
    resetDbForTests(`word-frequency-${createId('db')}`);
    resetWordFrequencyCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetWordFrequencyCache();
  });

  async function seenInPassing() {
    const db = getDb();
    const now = new Date().toISOString();
    const sentence: Sentence = {
      id: createId('sent'),
      normalizedKey: createId('key'),
      japanese: '本を読みます。',
      readingOnly: '',
      inlineReading: '本[ほん]を読[よ]みます。',
      translation: 'x',
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 0,
      importBatchIds: [],
      createdAt: now,
      updatedAt: now,
    };
    await db.sentences.put(sentence);
    const word = await ensureVocabularyItem('本', 'ほん');
    await db.sentenceVocabulary.put({
      id: createId('sv'),
      sentenceId: sentence.id,
      vocabularyItemId: word.id,
      surfaceForm: '本',
    } as SentenceVocabulary);
    const card = await ensureStudyItem('sentence', sentence.id, 'reading_in_context');
    await db.reviews.put({
      id: createId('review'),
      studyItemId: card.id,
      timestamp: now,
      rating: 'good',
      contextSentenceId: sentence.id,
    } as Review);
    return sentence;
  }

  it('a very common word seen in passing is not targeted, an untagged one is', async () => {
    const sentence = await seenInPassing();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await getWeakWordRecallTarget(sentence)).toMatchObject({ japanese: '本' });

    resetWordFrequencyCache();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ 本: 1 }) }));
    expect(await getWeakWordRecallTarget(sentence)).toBeUndefined();
  });
});
