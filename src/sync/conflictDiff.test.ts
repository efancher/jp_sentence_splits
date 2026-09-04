import { describe, expect, it } from 'vitest';

import {
  canonicalize,
  countChanges,
  diffLines,
  forDiff,
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

describe('forDiff', () => {
  it('drops sync-bookkeeping columns that only ever exist on the remote row', () => {
    // Regression: a remote row always carries owner_id/version/deleted_at/
    // client_id/last_modified_by, but the local domain payload never does —
    // undropped, every conflict diff showed these as spurious "added" lines
    // no matter what the learner actually changed (reported 2026-09-04).
    const local = { sentence_id: 'x', status: 'empty' };
    const remote = {
      sentence_id: 'x',
      status: 'empty',
      owner_id: 'user-1',
      version: 10,
      deleted_at: null,
      client_id: 'device-a',
      last_modified_by: 'user-1',
    };
    const rows = diffLines(prettyLines(forDiff(local)), prettyLines(forDiff(remote)));
    expect(countChanges(rows)).toBe(0);
  });

  it('still surfaces a real content difference alongside stripped bookkeeping', () => {
    const local = { sentence_id: 'x', status: 'empty', version: 1 };
    const remote = {
      sentence_id: 'x',
      status: 'done',
      owner_id: 'user-1',
      version: 2,
      deleted_at: null,
    };
    const rows = diffLines(prettyLines(forDiff(local)), prettyLines(forDiff(remote)));
    expect(countChanges(rows)).toBe(2); // status removed + status added, nothing else
  });

  it('leaves non-bookkeeping keys and nested content untouched', () => {
    expect(forDiff({ chunks: [{ version: 1 }], notes: 'hi' })).toEqual({
      chunks: [{ version: 1 }],
      notes: 'hi',
    });
  });
});
