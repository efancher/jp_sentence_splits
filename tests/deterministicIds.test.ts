import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  ensureGrammarPattern,
  ensureGrammarRelationship,
  ensureKanji,
  ensureSentenceGrammar,
  ensureVocabularyItem,
} from '../src/db/repository';
import { createId, deterministicId } from '../src/lib/ids';
import { updateSyncMeta } from '../src/sync/queue';

async function freshDevice(userId?: string) {
  resetDbForTests(`ids-${createId('db')}`);
  if (userId) await updateSyncMeta({ userId });
}

describe('deterministicId', () => {
  it('is stable for the same owner and key, and shaped like createId', () => {
    const a = deterministicId('kanji', 'user-1', '宮');
    expect(a).toBe(deterministicId('kanji', 'user-1', '宮'));
    expect(a).toMatch(/^kanji_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('differs by owner, by key, and by how the key is split', () => {
    const base = deterministicId('vocab_item', 'user-1', '猫', 'ねこ');
    expect(deterministicId('vocab_item', 'user-2', '猫', 'ねこ')).not.toBe(base);
    expect(deterministicId('vocab_item', 'user-1', '猫', 'ネコ')).not.toBe(base);
    expect(deterministicId('x', 'u', 'ab', 'c')).not.toBe(deterministicId('x', 'u', 'a', 'bc'));
  });

  it('spreads a realistic key set without collisions', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20000; i += 1) ids.add(deterministicId('kanji', 'user-1', String(i)));
    expect(ids.size).toBe(20000);
  });
});

describe('get-or-create ids (signed in)', () => {
  beforeEach(async () => {
    await freshDevice('user-1');
  });

  it('two devices for the same user mint identical ids for the same word', async () => {
    const first = await ensureVocabularyItem('宮本', 'みやもと');
    const kanji = await ensureKanji('宮');
    await freshDevice('user-1');
    const second = await ensureVocabularyItem('宮本', 'みやもと');

    expect(second.id).toBe(first.id);
    expect((await ensureKanji('宮')).id).toBe(kanji.id);
  });

  it('a different reading is a different word', async () => {
    const a = await ensureVocabularyItem('行く', 'いく');
    const b = await ensureVocabularyItem('行く', 'ゆく');
    expect(a.id).not.toBe(b.id);
  });

  it('grammar patterns, links and relationships converge too', async () => {
    const p1 = await ensureGrammarPattern('～ている', {});
    const p2 = await ensureGrammarPattern('～てある', {});
    const link = await ensureSentenceGrammar('sent_1', p1.id, {});
    const rel = await ensureGrammarRelationship(p1.id, p2.id, 'contrastive');
    await freshDevice('user-1');
    const q1 = await ensureGrammarPattern('～ている', {});
    const q2 = await ensureGrammarPattern('～てある', {});

    expect(q1.id).toBe(p1.id);
    expect((await ensureSentenceGrammar('sent_1', q1.id, {})).id).toBe(link.id);
    expect((await ensureGrammarRelationship(q2.id, q1.id, 'contrastive')).id).toBe(rel.id);
  });

  it('users do not share ids (they are global primary keys server-side)', async () => {
    const mine = await ensureKanji('宮');
    await freshDevice('user-2');
    expect((await ensureKanji('宮')).id).not.toBe(mine.id);
  });

  it('keeps returning an existing row rather than minting a new id', async () => {
    const first = await ensureVocabularyItem('犬', 'いぬ');
    expect((await ensureVocabularyItem('犬', 'いぬ')).id).toBe(first.id);
  });
});

describe('get-or-create ids (signed out)', () => {
  it('stay random: there is no owner to scope a global id by', async () => {
    await freshDevice();
    const a = await ensureKanji('宮');
    await freshDevice();
    const b = await ensureKanji('宮');
    expect(a.id).not.toBe(b.id);
  });
});
