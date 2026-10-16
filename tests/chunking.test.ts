import { describe, expect, it } from 'vitest';

import { previewHeuristicChunks } from '../src/lib/analysisHelpers';
import {
  chunkJapaneseSentence,
  roleForChunk,
  splitTrailingParticle,
  unsafeChunkBoundaries,
} from '../src/lib/chunking';

describe('chunkJapaneseSentence 紙 / 髪 passage', () => {
  it('keeps という, counter+noun together, sentence-final ね and 髪の毛 sensible', () => {
    expect(chunkJapaneseSentence('紙というのは、二つ言葉がありますね。一つは髪、髪の毛。')).toEqual([
      '紙というのは、',
      '二つ言葉が',
      'ありますね。',
      '一つは',
      '髪、',
      '髪の毛。',
    ]);
  });
});

describe('chunkJapaneseSentence やつ', () => {
  it('keeps やつ whole instead of splitting off や as a particle', () => {
    expect(chunkJapaneseSentence('もう一つは紙、何かを書いたりするやつですね。')).toEqual([
      'もう一つは',
      '紙、',
      '何かを',
      '書いたり',
      'するやつですね。',
    ]);
  });
});

describe('chunkJapaneseSentence regressions', () => {
  it('does not false-split inside ひな / なる', () => {
    expect(chunkJapaneseSentence('ひなたちは、毎日少しずつ大きくなりました。')).toEqual([
      'ひなたちは、',
      '毎日',
      '少しずつ大きくなりました。',
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

describe('chunkJapaneseSentence lexical words containing particle characters', () => {
  it.each([
    ['ひとりっ子です。', ['ひとりっ子です。']],
    ['ありがとう。', ['ありがとう。']],
    ['お気に入りの本。', ['お気に入りの', '本。']],
    ['朝ごはんを食べる。', ['朝ごはんを', '食べる。']],
    ['忘れがちです。', ['忘れがちです。']],
    ['どうやって行く?', ['どうやって', '行く?']],
    ['もともと行くとき、とても。', ['もともと行くとき、', 'とても。']],
  ])('keeps %s intact', (input, expected) => {
    expect(chunkJapaneseSentence(input)).toEqual(expected);
  });
});

describe('chunkJapaneseSentence assistant-reported boundary fixes', () => {
  it.each([
    ['このポッドキャストでは、', ['このポッドキャストでは、']],
    ['ここのところ忙しい。', ['ここの', 'ところ忙しい。']],
    ['家族について話します。', ['家族について', '話します。']],
    ['私にとって大事です。', ['私にとって', '大事です。']],
    ['ことだけに集中する。', ['ことだけに', '集中する。']],
    ['私からの直接の連絡。', ['私からの', '直接の', '連絡。']],
    ['週ごとのレッスン。', ['週ごとの', 'レッスン。']],
    ['初めてのエピソード。', ['初めての', 'エピソード。']],
    ['行けないかもしれません。', ['行けないかもしれません。']],
    ['気になるレストランが', ['気になるレストランが']],
    ['来るのでしょうか。', ['来るのでしょうか。']],
    ['勉強しながら別の本を読む。', ['勉強しながら', '別の', '本を', '読む。']],
    ['毎日朝ごはんを食べる。', ['毎日', '朝ごはんを', '食べる。']],
    ['時々公園に行く。', ['時々', '公園に', '行く。']],
    ['また次のエピソードで。', ['また', '次の', 'エピソードで。']],
    ['好き」「これを', ['好き」', '「これを']],
    ['よく言う「ゾーンに', ['よく', '言う', '「ゾーンに']],
    ['ここでのんびりする。', ['ここで', 'のんびりする。']],
  ])('%s', (input, expected) => {
    expect(chunkJapaneseSentence(input)).toEqual(expected);
  });

  it('does not peel よく/また from longer words', () => {
    expect(chunkJapaneseSentence('よくないことを言う。')[0]).toBe('よくないことを');
    expect(chunkJapaneseSentence('九時または十時に行く。')).toEqual(['九時または', '十時に', '行く。']);
  });
});


describe('fixed expressions and quoted connectives', () => {
  it('keeps quoted でもね intact without changing noun + でも', () => {
    const source = 'お母さん鳥は、「そうね」と答えた後、「でもね」と続けました。';
    const chunks = chunkJapaneseSentence(source);
    expect(chunks).toEqual(['お母さん鳥は、', '「そうね」と', '答えた後、', '「でもね」と', '続けました。']);
    expect(chunks.join('')).toBe(source);
    expect(roleForChunk('「でもね」と', false)).toBe('と-car');
    expect(roleForChunk('でも、', false)).toBe('clause connector');
    expect(chunkJapaneseSentence('雨でも行きます。')).toEqual(['雨でも', '行きます。']);
    expect(roleForChunk('雨でも', false)).toBe('でも-car');
  });
  it('recognizes a real trailing particle after a fixed adverb', () => {
    expect(roleForChunk('なんとか飛ぶことが', false)).toBe('Aが');
    expect(roleForChunk('なんとか', false)).toBe('modifier/content');
  });
  it('flags internal cuts, but permits a complete expression and a fused relative clause', () => {
    expect(unsafeChunkBoundaries(['なんと', 'か飛ぶことが', 'できました。'], 'なんとか飛ぶことができました。')).toHaveLength(1);
    expect(unsafeChunkBoundaries(['「でも', 'ね」と', '言いました。'], '「でもね」と言いました。')).toHaveLength(1);
    expect(unsafeChunkBoundaries(['なんとか', '飛ぶことが', 'できました。'], 'なんとか飛ぶことができました。')).toEqual([]);
    expect(unsafeChunkBoundaries(['穴が', '空いている木を', '見つけた。'], '穴が空いている木を見つけた。')).toEqual([]);
  });
});


describe('compound particle boundaries', () => {
  it.each([
    ['日本語については', 'については'],
    ['日本語についても', 'についても'],
    ['私にとっては', 'にとっては'],
    ['私にとっても', 'にとっても'],
    ['予報によると', 'によると'],
    ['予報によれば', 'によれば'],
  ])('keeps %s together and assigns its full particle role', (prefix, particle) => {
    const source = `${prefix}大事です。`;
    expect(chunkJapaneseSentence(source)).toEqual([prefix, '大事です。']);
    expect(splitTrailingParticle(prefix)).toEqual([prefix.slice(0, -particle.length), particle]);
    expect(roleForChunk(prefix, false)).toBe(`${particle}-car`);
    expect(unsafeChunkBoundaries([prefix, '大事です。'], source)).toEqual([]);
  });

  it.each(['について', 'については', 'についても', 'にとって', 'にとっては', 'にとっても', 'によると', 'によれば'])
    ('rejects every internal cut in %s', (particle) => {
      for (let at = 1; at < particle.length; at++) {
        expect(unsafeChunkBoundaries(['家族' + particle.slice(0, at), particle.slice(at), '話します。'], `家族${particle}話します。`)).toHaveLength(1);
      }
      expect(roleForChunk(particle + '。', true)).toBe(`${particle}-car`);
      expect(unsafeChunkBoundaries(['家族', particle, '話します。'], `家族${particle}話します。`)).toEqual([]);
    });

  it('keeps ordinary case particles and verb constructions available', () => {
    expect(chunkJapaneseSentence('学校に行きます。')).toEqual(['学校に', '行きます。']);
    expect(chunkJapaneseSentence('駅に着いて、話します。')).toEqual(['駅に', '着いて、', '話します。']);
  });
});
