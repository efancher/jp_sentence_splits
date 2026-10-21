import { describe, expect, it } from 'vitest';

import type { ClipRow } from '../scripts/lib/r2Migration';
import { decideCleanup, sha256, spreadSample } from '../scripts/lib/supabaseCopyCleanup';

const OWNER = '11111111-1111-1111-1111-111111111111';
const row = (over: Partial<ClipRow> = {}): ClipRow => ({
  id: 'a', storagePath: `${OWNER}/book_1/a.m4a`, sizeBytes: 100, mimeType: 'audio/mp4', ...over,
});
const present = (size: number) => ({ status: 'present' as const, size });

describe('Supabase copy cleanup decisions', () => {
  it('deletes only when the Supabase object exists and R2 holds the same size', () => {
    expect(decideCleanup(row(), OWNER, 100, present(100))).toBe('delete');
  });

  it('keeps anything not verified in R2, including a check error or refusal', () => {
    expect(decideCleanup(row(), OWNER, 100, { status: 'absent' })).toBe('skip_not_in_r2');
    expect(decideCleanup(row(), OWNER, 100, { status: 'error' })).toBe('skip_check_error');
    expect(decideCleanup(row(), OWNER, 100, { status: 'refused', code: 401 })).toBe('skip_check_error');
  });

  it('keeps objects when sizes disagree anywhere (R2, Supabase listing, recorded row size)', () => {
    expect(decideCleanup(row(), OWNER, 100, present(99))).toBe('skip_size_mismatch');
    expect(decideCleanup(row({ sizeBytes: 101 }), OWNER, 100, present(100))).toBe('skip_row_size_mismatch');
    expect(decideCleanup(row({ sizeBytes: null }), OWNER, 100, present(100))).toBe('delete');
  });

  it('keeps rows with no Supabase object, invalid keys, other owners and disallowed types', () => {
    expect(decideCleanup(row(), OWNER, undefined, present(100))).toBe('skip_no_supabase_object');
    expect(decideCleanup(row({ storagePath: null }), OWNER, 100, present(100))).toBe('skip_invalid');
    expect(decideCleanup(row({ storagePath: 'x/y/z.m4a' }), OWNER, 100, present(100))).toBe('skip_invalid');
    expect(decideCleanup(row({ storagePath: `22222222-2222-2222-2222-222222222222/b/a.m4a` }), OWNER, 100, present(100))).toBe('skip_invalid');
    expect(decideCleanup(row({ mimeType: 'text/html' }), OWNER, 100, present(100))).toBe('skip_invalid');
  });
});

describe('helpers', () => {
  it('spreads a sample evenly and returns everything for a small list', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    expect(spreadSample(items, 4)).toEqual([0, 25, 50, 75]);
    expect(spreadSample([1, 2], 5)).toEqual([1, 2]);
    expect(spreadSample(items, 0)).toEqual([]);
  });

  it('hashes identical bytes identically and different bytes differently', () => {
    expect(sha256(new Uint8Array([1, 2, 3]))).toBe(sha256(new Uint8Array([1, 2, 3])));
    expect(sha256(new Uint8Array([1, 2, 3]))).not.toBe(sha256(new Uint8Array([1, 2, 4])));
  });
});
