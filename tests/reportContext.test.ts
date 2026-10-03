import { describe, expect, it } from 'vitest';

import { collectReportContext, registerReportContext } from '../src/lib/reportContext';

describe('report context registry', () => {
  it('collects live providers and drops them on unregister', () => {
    let value = 1;
    const off = registerReportContext('a', () => ({ value }));
    value = 2;
    expect(collectReportContext()).toEqual({ a: { value: 2 } });
    off();
    expect(collectReportContext()).toEqual({});
  });

  it('isolates a throwing provider', () => {
    const off = registerReportContext('bad', () => { throw new Error('boom'); });
    expect(collectReportContext().bad).toEqual({ providerError: 'Error: boom' });
    off();
  });
});
