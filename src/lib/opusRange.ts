import { msToSamples, OPUS_SAMPLE_RATE, packetIndexAtSample, parseOggOpus } from './oggOpus';

/** Opus needs ~80 ms of earlier audio before the decoder output is clean. */
const PRE_ROLL_MS = 120;
/** Clips are stored mono at half the Opus rate: plenty for speech and pitch work. */
export const CLIP_SAMPLE_RATE = OPUS_SAMPLE_RATE / 2;

export function isOpusRangeDecodingSupported(): boolean {
  return typeof AudioDecoder !== 'undefined' && typeof EncodedAudioChunk !== 'undefined';
}

/**
 * Decode only `[startMs, endMs)` of an Ogg-Opus episode to mono PCM at
 * {@link CLIP_SAMPLE_RATE}, via WebCodecs (no whole-file `decodeAudioData`).
 */
export async function decodeOpusRange(
  episode: Blob,
  startMs: number,
  endMs: number,
): Promise<Float32Array> {
  if (!isOpusRangeDecodingSupported()) {
    throw new Error('This browser cannot decode Opus audio locally.');
  }
  const stream = parseOggOpus(new Uint8Array(await episode.arrayBuffer()));
  const startSample = Math.max(0, msToSamples(startMs));
  const endSample = Math.max(startSample, msToSamples(endMs));
  const first = packetIndexAtSample(stream, Math.max(0, startSample - msToSamples(PRE_ROLL_MS)));
  const last = Math.min(stream.packets.length - 1, packetIndexAtSample(stream, endSample));
  const firstPacketStart = stream.packets[first].startSample;

  const channels = Math.max(1, stream.channels);
  const decoded: Float32Array[] = [];
  let failure: Error | null = null;
  const decoder = new AudioDecoder({
    output: (data) => {
      const mono = new Float32Array(data.numberOfFrames);
      const plane = new Float32Array(data.numberOfFrames);
      for (let channel = 0; channel < channels; channel += 1) {
        data.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
        for (let i = 0; i < plane.length; i += 1) mono[i] += plane[i] / channels;
      }
      data.close();
      decoded.push(mono);
    },
    error: (error) => {
      failure = error;
    },
  });
  // Decoders differ on whether they drop the header's pre-skip from the first
  // packet they are given (ours is mid-stream), so hand them a header with none
  // and apply the pre-skip ourselves below.
  const head = stream.head.slice();
  head[10] = 0;
  head[11] = 0;
  decoder.configure({
    codec: 'opus',
    sampleRate: OPUS_SAMPLE_RATE,
    numberOfChannels: channels,
    description: head,
  });
  for (let index = first; index <= last; index += 1) {
    const packet = stream.packets[index];
    decoder.decode(
      new EncodedAudioChunk({
        type: 'key',
        timestamp: Math.round(((packet.startSample - firstPacketStart) * 1_000_000) / OPUS_SAMPLE_RATE),
        data: packet.data,
      }),
    );
  }
  await decoder.flush();
  decoder.close();
  if (failure) throw failure;

  const all = new Float32Array(decoded.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of decoded) {
    all.set(part, at);
    at += part.length;
  }
  // all[j] is stream sample firstPacketStart + j; real audio starts after the pre-skip.
  const from = Math.max(0, startSample + stream.preSkip - firstPacketStart);
  const to = Math.min(all.length, endSample + stream.preSkip - firstPacketStart);
  return downsampleByTwo(all.subarray(from, Math.max(from, to)));
}

function downsampleByTwo(samples: Float32Array): Float32Array {
  const out = new Float32Array(Math.floor(samples.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = (samples[2 * i] + samples[2 * i + 1]) / 2;
  return out;
}

/** 16-bit mono PCM WAV — plays and decodes everywhere, including iOS Safari. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}
