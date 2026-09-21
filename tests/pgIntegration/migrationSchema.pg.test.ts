import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { expectedSchemaFromMigrations } from '../../scripts/lib/migrationSchema';
import { PG_TESTS_ENABLED, sql } from './harness';

/**
 * `scripts/check-migrations-applied.ts` trusts `expectedSchemaFromMigrations` to
 * say which tables/columns prod should have. Here the real migrations have been
 * applied to a real Postgres, so the parser's answer is compared against what
 * that database actually contains — a migration written in a shape the parser
 * doesn't understand fails this test rather than quietly weakening the check.
 */
describe.skipIf(!PG_TESTS_ENABLED)('migration schema parser vs real Postgres', () => {
  it('matches information_schema for every public table', () => {
    const dir = join(__dirname, '../../supabase/migrations');
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
    const expected = expectedSchemaFromMigrations(files);

    const actual = new Map<string, Set<string>>();
    for (const line of sql(
      `select c.table_name || '.' || c.column_name from information_schema.columns c
       join information_schema.tables t using (table_schema, table_name)
       where c.table_schema = 'public' and t.table_type = 'BASE TABLE'`,
    )) {
      const [table, column] = line.split('.') as [string, string];
      (actual.get(table) ?? actual.set(table, new Set()).get(table)!).add(column);
    }

    const flatten = (m: Map<string, Set<string>>) =>
      [...m].flatMap(([table, columns]) => [...columns].map((c) => `${table}.${c}`)).sort();
    expect(flatten(expected)).toEqual(flatten(actual));
  });
});
