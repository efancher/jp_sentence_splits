/**
 * Minimal Ogg-Opus demuxer: just enough to pull the Opus packets covering a
 * time range out of a whole-episode file without decoding the rest. (iOS
 * Safari's `decodeAudioData` fails on multi-minute spans, so the episode is
 * never decoded whole.)
 */

export interface OpusStream {
  channels: number;
  preSkip: number;
  /** OpusHead packet, passed to WebCodecs as the decoder description. */
  head: Uint8Array;
  packets: OpusPacket[];
}

export interface OpusPacket {
  data: Uint8Array;
  /** Start of this packet in 48 kHz samples, from the first audio packet. */
  startSample: number;
  samples: number;
}

const OPUS_RATE = 48_000;

/** Samples (at 48 kHz) one Opus packet decodes to, from its TOC byte (RFC 6716 §3.1). */
export function opusPacketSamples(packet: Uint8Array): number {
  if (packet.length === 0) return 0;
  const toc = packet[0];
  const config = toc >> 3;
  let frameSamples: number;
  if (config < 12) frameSamples = [480, 960, 1920, 2880][config & 3];
  else if (config < 16) frameSamples = config & 1 ? 960 : 480;
  else frameSamples = [120, 240, 480, 960][config & 3];
  const code = toc & 3;
  let frames: number;
  if (code === 0) frames = 1;
  else if (code === 1 || code === 2) frames = 2;
  else frames = packet.length > 1 ? packet[1] & 0x3f : 0;
  return frameSamples * frames;
}

export function parseOggOpus(bytes: Uint8Array): OpusStream {
  const packets: Uint8Array[] = [];
  let pending: Uint8Array[] = [];
  let offset = 0;
  while (offset + 27 <= bytes.length) {
    if (
      bytes[offset] !== 0x4f ||
      bytes[offset + 1] !== 0x67 ||
      bytes[offset + 2] !== 0x67 ||
      bytes[offset + 3] !== 0x53
    ) {
      throw new Error('Not an Ogg stream (missing OggS capture pattern).');
    }
    const segmentCount = bytes[offset + 26];
    const tableStart = offset + 27;
    let dataOffset = tableStart + segmentCount;
    for (let i = 0; i < segmentCount; i += 1) {
      const lacing = bytes[tableStart + i];
      pending.push(bytes.subarray(dataOffset, dataOffset + lacing));
      dataOffset += lacing;
      if (lacing < 255) {
        packets.push(joinChunks(pending));
        pending = [];
      }
    }
    offset = dataOffset;
  }

  const head = packets[0];
  if (!head || head.length < 19 || String.fromCharCode(...head.subarray(0, 8)) !== 'OpusHead') {
    throw new Error('Not an Opus stream (missing OpusHead).');
  }
  const channels = head[9];
  const preSkip = head[10] | (head[11] << 8);

  const audio: OpusPacket[] = [];
  let startSample = 0;
  // packets[0] = OpusHead, packets[1] = OpusTags.
  for (const data of packets.slice(2)) {
    const samples = opusPacketSamples(data);
    audio.push({ data, startSample, samples });
    startSample += samples;
  }
  return { channels, preSkip, head, packets: audio };
}

function joinChunks(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Index of the packet containing `sample` (in 48 kHz samples after pre-skip). */
export function packetIndexAtSample(stream: OpusStream, sample: number): number {
  const target = Math.max(0, sample) + stream.preSkip;
  let low = 0;
  let high = stream.packets.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (stream.packets[mid].startSample <= target) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function msToSamples(ms: number): number {
  return Math.round((ms * OPUS_RATE) / 1000);
}

export const OPUS_SAMPLE_RATE = OPUS_RATE;
