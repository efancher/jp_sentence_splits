import { describe, expect, it } from 'vitest';

import { opusPacketSamples, packetIndexAtSample, parseOggOpus } from '../src/lib/oggOpus';
import { encodeWav } from '../src/lib/opusRange';
import { sourceEpisodeId, youtubeVideoId } from '../src/lib/sourceEpisodeCache';

/** One Ogg page holding the given packets (each < 255 bytes, so one lacing value apiece). */
function page(packets: Uint8Array[], sequence: number): Uint8Array {
  const header = new Uint8Array(27 + packets.length);
  header.set([0x4f, 0x67, 0x67, 0x53, 0, 0]);
  new DataView(header.buffer).setUint32(18, sequence, true);
  header[26] = packets.length;
  packets.forEach((packet, i) => {
    header[27 + i] = packet.length;
  });
  const out = new Uint8Array(header.length + packets.reduce((s, p) => s + p.length, 0));
  out.set(header);
  let at = header.length;
  for (const packet of packets) {
    out.set(packet, at);
    at += packet.length;
  }
  return out;
}

function opusHead(preSkip: number): Uint8Array {
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode('OpusHead'));
  head[8] = 1;
  head[9] = 1; // mono
  head[10] = preSkip & 0xff;
  head[11] = preSkip >> 8;
  return head;
}

const TOC_20MS_ONE_FRAME = 9 << 3; // config 9 = SILK NB 20 ms, code 0 (one frame)

function streamOf(packetCount: number, preSkip = 312): Uint8Array {
  const audio = Array.from({ length: packetCount }, () => new Uint8Array([TOC_20MS_ONE_FRAME, 1, 2, 3]));
  const tags = new TextEncoder().encode('OpusTags');
  const parts = [page([opusHead(preSkip)], 0), page([tags], 1), page(audio, 2)];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe('opusPacketSamples', () => {
  it('reads frame size and count from the TOC byte', () => {
    expect(opusPacketSamples(new Uint8Array([0x00]))).toBe(480); // SILK NB 10 ms, 1 frame
    expect(opusPacketSamples(new Uint8Array([TOC_20MS_ONE_FRAME]))).toBe(960);
    expect(opusPacketSamples(new Uint8Array([TOC_20MS_ONE_FRAME | 1]))).toBe(1920); // 2 frames
    expect(opusPacketSamples(new Uint8Array([TOC_20MS_ONE_FRAME | 3, 3]))).toBe(2880); // arbitrary, 3 frames
    expect(opusPacketSamples(new Uint8Array([0x78]))).toBe(960); // CELT FB 20 ms
    expect(opusPacketSamples(new Uint8Array([]))).toBe(0);
  });
});

describe('parseOggOpus', () => {
  it('skips the header packets and timestamps audio packets cumulatively', () => {
    const stream = parseOggOpus(streamOf(5));
    expect(stream.channels).toBe(1);
    expect(stream.preSkip).toBe(312);
    expect(stream.packets).toHaveLength(5);
    expect(stream.packets.map((p) => p.startSample)).toEqual([0, 960, 1920, 2880, 3840]);
  });

  it('finds the packet covering a time, allowing for pre-skip', () => {
    const stream = parseOggOpus(streamOf(10));
    expect(packetIndexAtSample(stream, 0)).toBe(0);
    // Real sample 700 + preSkip 312 = 1012 -> inside packet 1 (960..1919).
    expect(packetIndexAtSample(stream, 700)).toBe(1);
    expect(packetIndexAtSample(stream, 1_000_000)).toBe(9);
  });

  it('rejects data that is not Ogg', () => {
    expect(() => parseOggOpus(new Uint8Array(64))).toThrow(/Ogg/);
  });
});

describe('encodeWav', () => {
  it('writes a 16-bit mono PCM header and clamped samples', async () => {
    const blob = encodeWav(new Float32Array([0, 1, -1, 2]), 24_000);
    expect(blob.type).toBe('audio/wav');
    const view = new DataView(await blob.arrayBuffer());
    expect(blob.size).toBe(44 + 8);
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getInt16(44 + 2, true)).toBe(0x7fff);
    expect(view.getInt16(44 + 4, true)).toBe(-0x8000);
    expect(view.getInt16(44 + 6, true)).toBe(0x7fff); // clipped
  });
});

describe('youtubeVideoId', () => {
  it('handles watch, short and bare ids, and rejects other URLs', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=abcdefghijk&t=3')).toBe('abcdefghijk');
    expect(youtubeVideoId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk');
    expect(youtubeVideoId('abcdefghijk')).toBe('abcdefghijk');
    expect(youtubeVideoId('https://example.com/feed/ep1.mp3')).toBeUndefined();
  });
});

describe('sourceEpisodeId', () => {
  it('matches yt-dlp generic ids for podcast URLs and keeps YouTube ids', () => {
    expect(sourceEpisodeId('http://nihongoconteppei.com/wp-content/uploads/2026/08/Beginners-con-Teppei1557.mp3')).toBe('Beginners-con-Teppei1557');
    expect(sourceEpisodeId('https://d3ctxlq1ktw2nl.cloudfront.net/staging/2026-5-21/7bbcce1e-c415-af70-4fe7-c87116665e61.mp3')).toBe('7bbcce1e-c415-af70-4fe7-c87116665e61');
    expect(sourceEpisodeId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk');
    expect(sourceEpisodeId('not a url')).toBeUndefined();
  });
});
