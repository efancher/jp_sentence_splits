import { describe, expect, it } from 'vitest';

import { previewHeuristicChunks } from '../src/lib/analysisHelpers';
import {
  chunkJapaneseSentence,
  roleForChunk,
} from '../src/lib/chunking';

describe('chunkJapaneseSentence regressions', () => {
  it('does not false-split inside ひな / なる', () => {
    expect(chunkJapaneseSentence('ひなたちは、毎日少しずつ大きくなりました。')).toEqual([
      'ひなたちは、',
      '毎日少しずつ大きくなりました。',
    ]);
  });

  it('keeps です / でした intact', () => {
    const chunks = chunkJapaneseSentence('空は青くて、木々の緑がきれいでした。');
    expect(chunks.some((chunk) => chunk.includes('きれいでした'))).toBe(true);
    expect(chunks.some((chunk) => chunk === 'した' || chunk === 'した。')).toBe(
      false,
    );
  });

  it('guards common false cuts from the Python suite', () => {
    const cases: Record<string, string[]> = {
      '親鳥がえさを運んで来ました。': ['親鳥が', 'えさを', '運んで来ました。'],
      'とっても可愛いひなたちでした。': ['とっても', '可愛いひなたちでした。'],
      'そして、小鳥の奥さんは、卵を３つ産みました。': [
        'そして、',
        '小鳥の',
        '奥さんは、',
        '卵を',
        '３つ産みました。',
      ],
      'ひなは必死に羽ばたいて、なんとか飛ぶことができました。': [
        'ひなは',
        '必死に',
        '羽ばたいて、',
        'なんとか',
        '飛ぶことが',
        'できました。',
      ],
      'しかし、最後の１羽は怖がりで、なかなか飛び出すことができませんでした。': [
        'しかし、',
        '最後の',
        '１羽は',
        '怖がりで、',
        'なかなか飛び出すことが',
        'できませんでした。',
      ],
      '暖かい春がやって来ました。': ['暖かい春が', 'やって来ました。'],
      'お母さん鳥は喜んで、ひなと一緒に飛びました。': [
        'お母さん鳥は',
        '喜んで、',
        'ひなと',
        '一緒に',
        '飛びました。',
      ],
    };
    for (const [japanese, expected] of Object.entries(cases)) {
      expect(chunkJapaneseSentence(japanese)).toEqual(expected);
    }
  });

  it('suggests Cure Dolly–style roles', () => {
    const chunks = chunkJapaneseSentence('空は青くて、木々の緑がきれいでした。');
    const roles = chunks.map((chunk, index) =>
      roleForChunk(chunk, index === chunks.length - 1),
    );
    expect(roles.some((role) => role.includes('topic'))).toBe(true);
    expect(roles.some((role) => role === 'engine')).toBe(true);
  });

  it('treats 思い切って as て-car, not quotative って-car', () => {
    expect(roleForChunk('思い切って', false)).toBe('て-car');
    expect(roleForChunk('思って', false)).toBe('て-car');
    expect(roleForChunk('「えい！」って', false)).toBe('って-car');
    expect(roleForChunk('だって', false)).toBe('って-car');
  });
});

describe('previewHeuristicChunks', () => {
  it('returns spaced parts and roles without mutating caller state', () => {
    const preview = previewHeuristicChunks(
      '空は青くて、木々の緑がきれいでした。',
    );
    expect(preview.parts.length).toBeGreaterThan(1);
    expect(preview.roles).toHaveLength(preview.parts.length);
    expect(preview.spaced.split(/\s+/)).toEqual(preview.parts);
    expect(preview.roles.some((role) => role === 'engine')).toBe(true);
  });
});
