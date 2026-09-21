import { describe, expect, it } from 'vitest';

import { PG_TESTS_ENABLED, pgClientFor, resetDatabase, scalar, USER_A, USER_B } from './harness';

type Fluent = { from: (t: string) => any };

/** The take rows are read/written directly by the client, so RLS is the only thing keeping one learner's voice data from another. */
describe.skipIf(!PG_TESTS_ENABLED)('pitch_drill_takes RLS', () => {
  const row = (owner: string, id: string) => ({
    id,
    owner_id: owner,
    mode: 'word',
    transcript: 'ともだち',
    targets: [],
    results: [],
  });

  it('lets an owner insert, read and label their own take, and hides it from everyone else', async () => {
    resetDatabase();
    const a = pgClientFor(USER_A).client as Fluent;
    const b = pgClientFor(USER_B).client as Fluent;

    expect((await a.from('pitch_drill_takes').upsert(row(USER_A, 'take_a'))).error).toBeNull();
    expect((await a.from('pitch_drill_takes').update({ labels: { ともだち: 'right' } }).eq('id', 'take_a')).error).toBeNull();

    const own = await a.from('pitch_drill_takes').select('id, labels');
    expect(own.data).toEqual([{ id: 'take_a', labels: { ともだち: 'right' } }]);
    expect((await b.from('pitch_drill_takes').select('id')).data).toEqual([]);

    // B can neither forge a row as A nor overwrite A's take.
    expect((await b.from('pitch_drill_takes').insert(row(USER_A, 'take_forged'))).error).not.toBeNull();
    await b.from('pitch_drill_takes').update({ labels: { ともだち: 'off' } }).eq('id', 'take_a');
    expect(scalar(`select labels->>'ともだち' from public.pitch_drill_takes where id = 'take_a'`)).toBe('right');
  });

  it('rejects a mode outside sentence/word', async () => {
    resetDatabase();
    const a = pgClientFor(USER_A).client as Fluent;
    expect((await a.from('pitch_drill_takes').insert({ ...row(USER_A, 'take_bad'), mode: 'nope' })).error).not.toBeNull();
  });
});
