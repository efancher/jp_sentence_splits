import { beforeEach, describe, expect, it } from 'vitest';

import { takeImportExtrasNotice, writeImportExtrasNotice } from '../src/lib/quickImportExtras';

describe('import extras notice', () => {
  beforeEach(() => localStorage.clear());

  it('is returned once per book and then cleared', () => {
    writeImportExtrasNotice('b1', 'Could not tell which chapter to attach the focus targets and structure to.');
    expect(takeImportExtrasNotice('b2')).toBeNull();
    expect(takeImportExtrasNotice('b1')).toContain('which chapter');
    expect(takeImportExtrasNotice('b1')).toBeNull();
  });
});
