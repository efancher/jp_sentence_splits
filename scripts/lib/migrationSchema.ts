/**
 * Replays `supabase/migrations/*.sql` (in filename order) into the set of
 * `public` tables and columns they leave behind, so a script can probe a live
 * database for anything a migration promised but the database doesn't have.
 *
 * Deliberately narrow: it understands `create table`, `alter table … add /
 * drop / rename column` and `drop table` — the shapes these migrations use —
 * and ignores everything else (policies, indexes, functions, constraints).
 * `tests/pgIntegration/migrationSchema.pg.test.ts` checks its output against a
 * real Postgres with the same migrations applied, so a migration that uses a
 * shape this parser doesn't handle fails there instead of silently drifting.
 */
export type ExpectedSchema = Map<string, Set<string>>;

export interface MigrationFile {
  name: string;
  sql: string;
}

/** Blanks comments, string literals and `$$…$$` bodies so `;` and `,` inside them can't split anything. */
function maskNonStructural(sql: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/--[^\n]*/g, blank)
    .replace(/(\$[A-Za-z_]*\$)[\s\S]*?\1/g, blank)
    .replace(/'(?:[^']|'')*'/g, blank);
}

/** Splits at `separator` outside parentheses. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

const TABLE_REF = String.raw`(?:"?(\w+)"?\.)?"?(\w+)"?`;
const NOT_A_COLUMN = /^(constraint|primary|unique|foreign|check|exclude|like)\b/i;

const unquote = (id: string) => id.replace(/"/g, '').toLowerCase();

/** `public.x` and bare `x` are ours; `storage.objects`, `sync_private.…` are not. */
function publicTable(schema: string | undefined, name: string): string | null {
  return schema === undefined || schema.toLowerCase() === 'public' ? name.toLowerCase() : null;
}

function applyCreateTable(statement: string, schema: ExpectedSchema): void {
  const head = statement.match(new RegExp(String.raw`^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${TABLE_REF}\s*\(`, 'i'));
  if (!head) return;
  const table = publicTable(head[1], head[2]!);
  if (!table) return;
  const open = statement.indexOf('(', head[0].length - 1);
  let depth = 0;
  let close = -1;
  for (let i = open; i < statement.length; i += 1) {
    if (statement[i] === '(') depth += 1;
    else if (statement[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return;
  const columns = schema.get(table) ?? new Set<string>();
  for (const item of splitTopLevel(statement.slice(open + 1, close), ',')) {
    if (NOT_A_COLUMN.test(item)) continue;
    const name = item.match(/^("[^"]+"|\w+)/);
    if (name) columns.add(unquote(name[1]!));
  }
  schema.set(table, columns);
}

function applyAlterTable(statement: string, schema: ExpectedSchema): void {
  const head = statement.match(new RegExp(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${TABLE_REF}\s+`, 'i'));
  if (!head) return;
  const table = publicTable(head[1], head[2]!);
  if (!table) return;
  const columns = schema.get(table);
  if (!columns) return;
  for (const clause of splitTopLevel(statement.slice(head[0].length), ',')) {
    const rename = clause.match(/^rename\s+(?:column\s+)?("[^"]+"|\w+)\s+to\s+("[^"]+"|\w+)/i);
    if (rename) {
      columns.delete(unquote(rename[1]!));
      columns.add(unquote(rename[2]!));
      continue;
    }
    const drop = clause.match(/^drop\s+column\s+(?:if\s+exists\s+)?("[^"]+"|\w+)/i);
    if (drop) {
      columns.delete(unquote(drop[1]!));
      continue;
    }
    const add = clause.match(/^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?("[^"]+"|\w+)/i);
    if (add && !NOT_A_COLUMN.test(clause.replace(/^add\s+/i, ''))) columns.add(unquote(add[1]!));
  }
}

export function expectedSchemaFromMigrations(files: MigrationFile[]): ExpectedSchema {
  const schema: ExpectedSchema = new Map();
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const statement of splitTopLevel(maskNonStructural(file.sql), ';')) {
      const dropTable = statement.match(new RegExp(String.raw`^drop\s+table\s+(?:if\s+exists\s+)?${TABLE_REF}`, 'i'));
      if (dropTable) {
        const table = publicTable(dropTable[1], dropTable[2]!);
        if (table) schema.delete(table);
        continue;
      }
      applyCreateTable(statement, schema);
      applyAlterTable(statement, schema);
    }
  }
  return schema;
}
