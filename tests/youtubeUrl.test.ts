import { describe, expect, it } from 'vitest';

import { extractYouTubeId } from '../src/lib/youtubeUrl';

describe('extractYouTubeId', () => {
  it('pulls the id from a standard watch URL regardless of extra params', () => {
    expect(
      extractYouTubeId('https://www.youtube.com/watch?v=ptXJnNgYhi8'),
    ).toBe('ptXJnNgYhi8');
    expect(
      extractYouTubeId('https://www.youtube.com/watch?v=ptXJnNgYhi8&t=42s&list=abc'),
    ).toBe('ptXJnNgYhi8');
    expect(
      extractYouTubeId('https://www.youtube.com/watch?list=abc&v=ptXJnNgYhi8'),
    ).toBe('ptXJnNgYhi8');
  });

  it('handles youtu.be, shorts, embed and live forms', () => {
    expect(extractYouTubeId('https://youtu.be/ptXJnNgYhi8')).toBe('ptXJnNgYhi8');
    expect(extractYouTubeId('https://www.youtube.com/shorts/ptXJnNgYhi8')).toBe(
      'ptXJnNgYhi8',
    );
    expect(extractYouTubeId('https://www.youtube.com/embed/ptXJnNgYhi8')).toBe(
      'ptXJnNgYhi8',
    );
    expect(extractYouTubeId('https://www.youtube.com/live/ptXJnNgYhi8')).toBe(
      'ptXJnNgYhi8',
    );
  });

  it('accepts a bare 11-character id', () => {
    expect(extractYouTubeId('ptXJnNgYhi8')).toBe('ptXJnNgYhi8');
    expect(extractYouTubeId('  ptXJnNgYhi8  ')).toBe('ptXJnNgYhi8');
  });

  it('returns null when there is no id', () => {
    expect(extractYouTubeId('')).toBeNull();
    expect(extractYouTubeId('https://example.com/not-youtube')).toBeNull();
    expect(extractYouTubeId('just some text')).toBeNull();
  });
});
