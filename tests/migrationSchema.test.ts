import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { expectedSchemaFromMigrations } from '../scripts/lib/migrationSchema';

const cols = (sql: string, table: string, prior: { name: string; sql: string }[] = []) =>
  [...(expectedSchemaFromMigrations([...prior, { name: '9999_test.sql', sql }]).get(table) ?? [])].sort();

describe('expectedSchemaFromMigrations', () => {
  it('reads create table columns and skips table constraints', () => {
    const sql = `create table public.t (
      id text primary key,
      owner_id uuid not null references auth.users (id) on delete cascade,
      n integer not null default 0 check (n >= 0),
      tags text[] not null default '{}',
      primary key (id, owner_id),
      constraint t_n unique (n, tags),
      foreign key (owner_id) references public.u (id)
    );`;
    expect(cols(sql, 't')).toEqual(['id', 'n', 'owner_id', 'tags']);
  });

  it('applies add / drop / rename column, including several clauses in one alter', () => {
    const sql = `create table public.t (id text primary key, a text, b text);
      alter table public.t add column if not exists c text, add column d integer default 1;
      alter table public.t drop column if exists a, drop column b;
      alter table only public.t rename column c to e;
      alter table public.t add constraint t_d unique (d);`;
    expect(cols(sql, 't')).toEqual(['d', 'e', 'id']);
  });

  it('honours migration order by filename and drop table', () => {
    const files = [
      { name: '2_drop.sql', sql: 'drop table if exists public.gone;' },
      { name: '1_make.sql', sql: 'create table public.gone (id text); create table public.kept (id text);' },
    ];
    const schema = expectedSchemaFromMigrations(files);
    expect(schema.has('gone')).toBe(false);
    expect(schema.has('kept')).toBe(true);
  });

  it('ignores other schemas, comments, strings and function bodies', () => {
    const sql = `
      -- create table public.commented (id text);
      /* create table public.blocked (id text); */
      create table sync_private.hidden (id text);
      create function public.f() returns void language plpgsql as $$
      begin
        create table public.in_body (id text);
        perform 'create table public.in_string (id text);';
      end $$;
      comment on table public.real is 'a; b, c';
      create table public.real (id text, note text default 'x, y; z');`;
    const schema = expectedSchemaFromMigrations([{ name: '1.sql', sql }]);
    expect([...schema.keys()]).toEqual(['real']);
    expect([...schema.get('real')!].sort()).toEqual(['id', 'note']);
  });

  it('replays the real migrations into the tables the app syncs', () => {
    const dir = join(__dirname, '../supabase/migrations');
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
    const schema = expectedSchemaFromMigrations(files);
    expect(schema.get('sentence_vocabulary')).toContain('audio_start_ms');
    expect(schema.get('reference_alignment')).toContain('alignment_version');
    expect(schema.has('wanikani_subjects')).toBe(false);
    expect(schema.get('vocabulary_items')).not.toContain('meaning_mnemonic');
  });
});
