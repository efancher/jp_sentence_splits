import { describe, expect, it } from 'vitest';

import {
  canonicalize,
  conflictContentsMatch,
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

  it('drops updatedAt, since a DB trigger always overwrites it with the server clock', () => {
    // set_updated_at() (supabase/migrations/20260722000000_sync_schema.sql)
    // stamps every UPDATE with now() regardless of what the client sent, so
    // it differs after every push whether or not real content changed.
    const local = { status: 'empty', updated_at: '2026-09-04T22:05:32.465Z' };
    const remote = {
      status: 'empty',
      updated_at: '2026-09-04T22:05:41.276176+00:00',
    };
    const rows = diffLines(prettyLines(forDiff(local)), prettyLines(forDiff(remote)));
    expect(countChanges(rows)).toBe(0);
  });

  it('treats an absent optional field the same as an explicit null', () => {
    // Local domain payloads omit unset optional fields entirely
    // (chunkId?: string); every *ToRemote mapper writes them as
    // `column: value ?? null` — these must compare equal, not diff.
    const local = { id: 'sv_1', surface_form: '食べた' };
    const remote = {
      id: 'sv_1',
      surface_form: '食べた',
      chunk_id: null,
      audio_start_ms: null,
      audio_end_ms: null,
    };
    const rows = diffLines(prettyLines(forDiff(local)), prettyLines(forDiff(remote)));
    expect(countChanges(rows)).toBe(0);
  });

  it('collapses Z vs. +00:00 and differing sub-second precision for the same instant', () => {
    const local = { created_at: '2026-09-04T21:47:25.793Z' };
    const remote = { created_at: '2026-09-04T21:47:25.793000+00:00' };
    const rows = diffLines(prettyLines(forDiff(local)), prettyLines(forDiff(remote)));
    expect(countChanges(rows)).toBe(0);
  });

  it('still reports a real datetime difference after normalizing format', () => {
    const local = { created_at: '2026-08-27T18:34:52.932Z' };
    const remote = { created_at: '2026-09-04T22:05:40.925Z' };
    const rows = diffLines(prettyLines(forDiff(local)), prettyLines(forDiff(remote)));
    expect(countChanges(rows)).toBe(2);
  });
});

describe('conflictContentsMatch', () => {
  it('is true for a version_conflict with no real content difference', () => {
    // A CAS mismatch doesn't mean the content diverged — two saves that
    // land on the same resulting state should settle automatically rather
    // than surface an empty conflict card.
    const local = {
      status: 'empty',
      chunk_id: undefined,
      updated_at: '2026-09-04T22:05:32.465Z',
    };
    const remote = {
      status: 'empty',
      chunk_id: null,
      version: 46,
      owner_id: 'user-1',
      updated_at: '2026-09-04T22:05:41.276176+00:00',
    };
    expect(conflictContentsMatch(local, remote)).toBe(true);
  });

  it('is false when real content actually differs', () => {
    const local = { status: 'empty', version: 45 };
    const remote = { status: 'done', version: 46 };
    expect(conflictContentsMatch(local, remote)).toBe(false);
  });
});
