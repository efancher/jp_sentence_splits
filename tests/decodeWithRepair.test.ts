import { describe, expect, it, vi } from 'vitest';

import { decodeWithRepair, describeDecodeError } from '../src/lib/decodeWithRepair';

const buffer = { duration: 3 } as AudioBuffer;
const blob = (name: string) => new Blob([name]);

describe('decodeWithRepair', () => {
  it('decodes the local copy when it works, without touching the network', async () => {
    const repair = vi.fn();
    const decode = vi.fn(async () => buffer);
    expect(await decodeWithRepair(blob('local'), 'a1', repair, decode)).toBe(buffer);
    expect(repair).not.toHaveBeenCalled();
  });

  it('re-downloads the recording and decodes that when the local blob will not decode', async () => {
    const fresh = blob('fresh');
    const repair = vi.fn(async () => fresh);
    const decode = vi.fn(async (b: Blob) => {
      if (b === fresh) return buffer;
      throw Object.assign(new Error('Unable to decode audio data'), { name: 'EncodingError' });
    });
    expect(await decodeWithRepair(blob('bad'), 'a1', repair, decode)).toBe(buffer);
    expect(repair).toHaveBeenCalledWith('a1');
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it('names the failure when there is no cloud copy to repair from', async () => {
    const decode = vi.fn(async () => {
      throw Object.assign(new Error('Unable to decode audio data'), { name: 'EncodingError' });
    });
    await expect(decodeWithRepair(blob('bad'), 'a1', async () => null, decode)).rejects.toThrow(
      'EncodingError: Unable to decode audio data (no cloud copy to repair from)',
    );
  });

  it('treats a repair that throws (offline, signed out) like no cloud copy', async () => {
    const decode = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(
      decodeWithRepair(blob('bad'), 'a1', async () => {
        throw new Error('network');
      }, decode),
    ).rejects.toThrow(/no cloud copy/);
  });

  it('says so when the fresh copy fails too', async () => {
    const decode = vi.fn(async () => {
      throw new Error('still bad');
    });
    await expect(decodeWithRepair(blob('bad'), 'a1', async () => blob('fresh'), decode)).rejects.toThrow(
      /still failing after re-downloading/,
    );
  });

  it('describes non-Error rejections', () => {
    expect(describeDecodeError('oops')).toBe('oops');
  });
});
