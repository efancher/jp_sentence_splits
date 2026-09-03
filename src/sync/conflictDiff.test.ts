import { describe, expect, it } from 'vitest';

import {
  canonicalize,
  countChanges,
  diffLines,
  prettyLines,
} from './conflictDiff';

describe('canonicalize', () => {
  it('camel-cases snake_case keys and sorts recursively', () => {
    const out = canonicalize({
      sentence_id: 'x',
      format_version: 3,
      vocabulary_selections: [{ end: 2, start: 0, suggestion_ids: ['a'] }],
    });
    expect(JSON.stringify(out)).toBe(
      JSON.stringify({
        formatVersion: 3,
        sentenceId: 'x',
        vocabularySelections: [{ end: 2, start: 0, suggestionIds: ['a'] }],
      }),
    );
  });

  it('leaves arrays in order', () => {
    expect(canonicalize([3, 1, 2])).toEqual([3, 1, 2]);
  });
});

describe('diffLines', () => {
  it('marks only the changed line when keys are normalised', () => {
    const local = prettyLines({ sentence_id: 'x', status: 'empty' });
    const remote = prettyLines({ sentenceId: 'x', status: 'done', version: 10 });
    const rows = diffLines(local, remote);
    expect(countChanges(rows)).toBe(3); // status removed + status added + version added
    expect(rows.filter((r) => r.type === 'context').map((r) => r.text)).toEqual([
      '{',
      '  "sentenceId": "x",',
      '}',
    ]);
  });

  it('reports no changes for equivalent payloads', () => {
    const rows = diffLines(
      prettyLines({ a_b: 1, c: 2 }),
      prettyLines({ aB: 1, c: 2 }),
    );
    expect(countChanges(rows)).toBe(0);
  });
});
