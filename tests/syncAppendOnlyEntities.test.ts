import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { APPEND_ONLY_ENTITIES } from '../src/sync/queue';

describe('APPEND_ONLY_ENTITIES', () => {
  it('covers every synced table whose RLS allows insert but not update', () => {
    // A table missing here gets its retried pushes misreported as conflicts
    // (reported 2026-11-17 for sentence_learning_events).
    const dir = join(process.cwd(), 'supabase/migrations');
    const sql = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => readFileSync(join(dir, name), 'utf8'))
      .join('\n')
      .replace(/\s+/g, ' ');
    const policies = [...sql.matchAll(/create policy \w+ on public\.(\w+) for (\w+)/gi)];
    const withVerb = (verbs: string[]) =>
      new Set(policies.filter((m) => verbs.includes(m[2]!.toLowerCase())).map((m) => m[1]!));
    const updatable = withVerb(['update', 'all']);
    const insertOnly = [...withVerb(['insert', 'all'])].filter((table) => !updatable.has(table)).sort();

    expect(insertOnly).toEqual([...APPEND_ONLY_ENTITIES].sort());
  });
});
