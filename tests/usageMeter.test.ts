import { describe, expect, it } from 'vitest';
import { usageMeter } from './helpers/usageMeter';

describe('test HTTP accounting', () => {
  it('counts UTF-8 bytes and binary bodies without consuming the caller response', async () => {
    const meter = usageMeter(async () => new Response(new Uint8Array(4096)));
    const response = await meter.fetch('http://fixture.test/storage/v1/object/audio', {
      method: 'POST', body: '日本語',
    });
    expect((await response.arrayBuffer()).byteLength).toBe(4096);
    expect(meter.totals('storage')).toEqual({ requests: 1, requestBodyBytes: 9, responseBodyBytes: 4096 });
    expect(meter.totals('database').requests).toBe(0);
    meter.reset();
    expect(meter.totals()).toEqual({ requests: 0, requestBodyBytes: 0, responseBodyBytes: 0 });
  });

  it('counts failed attempts and error-response bodies', async () => {
    const meter = usageMeter(async () => { throw new TypeError('offline'); });
    await expect(meter.fetch('http://fixture.test/rest/v1/books')).rejects.toThrow('offline');
    expect(meter.totals()).toEqual({ requests: 1, requestBodyBytes: 0, responseBodyBytes: 0 });
    const errors = usageMeter(async () => new Response('error', { status: 503 }));
    await errors.fetch('http://fixture.test/functions/v1/example');
    expect(errors.totals('functions').responseBodyBytes).toBe(5);
  });
});
