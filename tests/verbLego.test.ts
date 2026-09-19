import { describe, expect, it } from 'vitest';

import type { GameRound, Sentence, VocabularySuggestion } from '../src/domain/types';
import {
  auxDecoys,
  buildVerbLegoHistory,
  buildVerbLegoPuzzle,
  chainSignature,
  chainStats,
  describeChainPick,
  findVerbChains,
  isVerbLegoEligible,
  scoreVerbLego,
  verbLegoMissFocus,
  verbLegoPointsAvailable,
  verbStems,
} from '../src/lib/verbLego';

type Tok = { surface: string; lemma: string; reading?: string; pos: string; english?: string };

/** Build a sentence whose tokens are laid out contiguously from the given list (plus optional gaps). */
function sentence(tokens: (Tok | string)[], translation = 'A translation.'): Pick<Sentence, 'id' | 'japanese' | 'translation' | 'vocabularySuggestions'> {
  let japanese = '';
  const suggestions: VocabularySuggestion[] = [];
  tokens.forEach((t, i) => {
    if (typeof t === 'string') {
      japanese += t; // filler text, no token
      return;
    }
    const start = japanese.length;
    japanese += t.surface;
    suggestions.push({
      id: `t${i}`,
      surface: t.surface,
      start,
      end: japanese.length,
      expression: t.lemma,
      reading: t.reading ?? t.lemma,
      pos: t.pos,
      english: t.english,
      source: 'morphology',
      selectedByDefault: false,
    });
  });
  return { id: 's1', japanese, translation, vocabularySuggestions: suggestions };
}

const V = (surface: string, lemma: string, reading: string): Tok => ({ surface, lemma, reading, pos: '動詞/一般' });
const A = (surface: string, lemma: string): Tok => ({ surface, lemma, pos: '助動詞' });

const PASSIVE_PAST = sentence(['事実の後、', V('聞か', '聞く', 'きく'), A('れ', 'れる'), A('た', 'た'), '。']);

describe('findVerbChains', () => {
  it('reads a stacked chain out of the tokens, with labels and keys, matching the sentence span', () => {
    const [chain] = findVerbChains(PASSIVE_PAST);
    expect(chain!.lemma).toBe('聞く');
    expect(chain!.pieces.map((p) => p.text)).toEqual(['聞か', 'れ', 'た']);
    expect(chain!.pieces.map((p) => p.key)).toEqual(['stem:れる', 'れる|れ', 'た|た']);
    expect(PASSIVE_PAST.japanese.slice(chain!.start, chain!.end)).toBe('聞かれた');
    expect(chain!.pieces[0]!.label).toMatch(/stem \(before れ\)/);
  });

  it('needs at least two auxiliaries (a single 食べ+た is not a stack)', () => {
    expect(findVerbChains(sentence([V('食べ', '食べる', 'たべる'), A('た', 'た')]))).toEqual([]);
  });

  it('stops at the first auxiliary outside the whitelist and keeps the earlier ones', () => {
    const s = sentence([V('やっ', 'やる', 'やる'), A('て', 'てる'), A('ない', 'ない'), A('だろう', 'だ')]);
    const [chain] = findVerbChains(s);
    expect(chain!.pieces.map((p) => p.text)).toEqual(['やっ', 'て', 'ない']);
    // an aux that is out-of-whitelist immediately after the verb ends the chain before it starts
    expect(findVerbChains(sentence([V('言い', '言う', 'いう'), A('だろう', 'だ'), A('た', 'た')]))).toEqual([]);
  });

  it('ignores chains that are not contiguous, irregular する/来る verbs, and non-verbs', () => {
    expect(findVerbChains(sentence([V('食べ', '食べる', 'たべる'), 'ま', A('ない', 'ない'), A('た', 'た')]))).toEqual([]);
    expect(findVerbChains(sentence([V('し', 'する', 'する'), A('ませ', 'ます'), A('ん', 'ぬ')]))).toEqual([]);
    expect(
      findVerbChains(sentence([{ surface: '高', lemma: '高い', pos: '形容詞/一般' }, A('かっ', 'ない'), A('た', 'た')])),
    ).toEqual([]);
  });

  it('drops tokens whose stored span does not match the text', () => {
    const s = sentence([V('聞か', '聞く', 'きく'), A('れ', 'れる'), A('た', 'た')]);
    s.vocabularySuggestions[1]!.start += 1;
    s.vocabularySuggestions[1]!.end += 1;
    expect(findVerbChains(s)).toEqual([]);
  });

  it('eligibility also needs a translation', () => {
    expect(isVerbLegoEligible(PASSIVE_PAST)).toBe(true);
    expect(isVerbLegoEligible({ ...PASSIVE_PAST, translation: ' ' })).toBe(false);
  });
});

describe('verbStems', () => {
  it('derives the a/i/te-stems and dictionary form of a godan verb — not the e-stem (聞けない is real)', () => {
    expect(verbStems('聞く', 'きく')!.sort()).toEqual(['聞い', '聞か', '聞き', '聞く'].sort());
  });
  it('an ichidan verb has one stem plus the dictionary form — never the ら抜き 食べれ', () => {
    expect(verbStems('食べる', 'たべる')!.sort()).toEqual(['食べ', '食べる'].sort());
  });
  it('declines irregular する/来る', () => {
    expect(verbStems('する', 'する')).toBeNull();
  });
});

describe('auxDecoys — only certainly-wrong alternatives', () => {
  const piece = (lemma: string, text: string) => ({ text, label: '', key: `${lemma}|${text}`, kind: 'aux' as const, lemma });

  it('offers the wrong allomorph after a godan a-stem (られ for れ), never the reverse (ら抜き)', () => {
    expect(auxDecoys(piece('れる', 'れ'), '聞か')).toEqual(expect.arrayContaining(['られ', 'れる']));
    expect(auxDecoys(piece('られる', 'られ'), '食べ')).not.toContain('れ');
    expect(auxDecoys(piece('られる', 'られ'), '食べ')).not.toContain('れる');
    expect(auxDecoys(piece('せる', 'せ'), '聞か')).toContain('させ');
    expect(auxDecoys(piece('させる', 'させ'), '食べ')).not.toContain('せ');
  });

  it('uses other forms of the same lemma (they carry a different label)', () => {
    expect(auxDecoys(piece('ない', 'なかっ'), '食べ')).toEqual(expect.arrayContaining(['ない', 'なく']));
    expect(auxDecoys(piece('ます', 'まし'), '言い')).toEqual(expect.arrayContaining(['ます', 'ませ']));
  });

  it('only offers the voiced/unvoiced twin when the preceding piece rules it out', () => {
    // correct た after れ: だ is certainly wrong
    expect(auxDecoys(piece('た', 'た'), 'れ')).toContain('だ');
    // correct た after い/ん: だ could be right for a ぐ/ん verb — don't offer it
    expect(auxDecoys(piece('た', 'た'), '書い')).not.toContain('だ');
    expect(auxDecoys(piece('た', 'た'), '読ん')).not.toContain('だ');
    // て after 考え: で is wrong; て after 泳い: で could be right
    expect(auxDecoys(piece('てる', 'て'), '考え')).toContain('で');
    expect(auxDecoys(piece('てる', 'て'), '泳い')).not.toContain('で');
    // で after 読ん: て is certainly wrong
    expect(auxDecoys(piece('でる', 'で'), '読ん')).toContain('て');
  });
});

describe('buildVerbLegoPuzzle', () => {
  const chain = findVerbChains(PASSIVE_PAST)[0]!;

  it('has every answer once plus 2-3 decoys that are never a correct piece', () => {
    const puzzle = buildVerbLegoPuzzle(chain, 'seed');
    expect(puzzle.answers).toEqual(['聞か', 'れ', 'た']);
    const texts = puzzle.bank.map((c) => c.text);
    for (const answer of puzzle.answers) expect(texts.filter((t) => t === answer)).toHaveLength(1);
    const decoys = texts.filter((t) => !puzzle.answers.includes(t));
    expect(decoys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(decoys).size).toBe(decoys.length);
    expect(new Set(puzzle.bank.map((c) => c.id)).size).toBe(puzzle.bank.length);
  });

  it('draws a stem decoy from the verb’s own stems when the real stem is among them', () => {
    const decoyStems = new Set(['聞き', '聞い', '聞く']);
    const seen = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      for (const c of buildVerbLegoPuzzle(chain, seed).bank) if (decoyStems.has(c.text)) seen.add(c.text);
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it('gives no stem decoys when the real stem is not among the derived stems (class inference suspect)', () => {
    const odd = { ...chain, lemma: '聞く', pieces: [{ ...chain.pieces[0]!, text: '謎' }, ...chain.pieces.slice(1)] };
    const texts = buildVerbLegoPuzzle(odd, 'seed').bank.map((c) => c.text);
    for (const stem of ['聞き', '聞い', '聞け', '聞く', '聞か']) expect(texts).not.toContain(stem);
    expect(buildVerbLegoPuzzle(chain, 'x').bank.map((c) => c.text)).not.toContain('聞け');
  });

  it('is deterministic for a seed', () => {
    expect(buildVerbLegoPuzzle(chain, 'k')).toEqual(buildVerbLegoPuzzle(chain, 'k'));
  });

  it('a four-piece chain gets three decoys', () => {
    const s = sentence([V('考え', '考える', 'かんがえる'), A('て', 'てる'), A('ない', 'ない'), A('だろう', 'だ')]);
    const long = findVerbChains(s)[0]!;
    expect(long.pieces).toHaveLength(3); // だろう cut off
    const four = findVerbChains(sentence([V('聞か', '聞く', 'きく'), A('せ', 'せる'), A('られ', 'られる'), A('た', 'た')]))[0]!;
    expect(four.pieces).toHaveLength(4);
    const texts = buildVerbLegoPuzzle(four, 'x').bank.map((c) => c.text);
    expect(texts.length).toBe(4 + 3);
  });
});

describe('scoring, signature, history', () => {
  const chain = findVerbChains(PASSIVE_PAST)[0]!;
  const puzzle = buildVerbLegoPuzzle(chain, 's');

  it('one point per slot, minus one per wrong tap, floor 0', () => {
    expect(verbLegoPointsAvailable(3, 0)).toBe(3);
    expect(verbLegoPointsAvailable(3, 5)).toBe(0);
    const scored = scoreVerbLego(puzzle, [['聞き'], [], ['だ', 'たら']]);
    expect(scored).toMatchObject({ wrongCount: 3, points: 0, maxPoints: 3, allCorrect: false });
    expect(scored.slots.map((s) => s.correct)).toEqual([false, true, false]);
    expect(scored.slots[0]!.key).toBe('stem:れる');
  });

  it('signature identifies the suffix pattern, ignoring the verb', () => {
    const other = findVerbChains(sentence([V('言わ', '言う', 'いう'), A('れ', 'れる'), A('た', 'た')]))[0]!;
    expect(chainSignature(chain)).toBe(chainSignature(other));
    expect(chainSignature(chain)).toBe('れる|れ>た|た');
  });

  const round = (timestamp: string, parts: { key: string; correct: boolean }[]): GameRound => ({
    id: timestamp,
    timestamp,
    gameId: 'verb-lego',
    signal: 'any',
    poolSize: 5,
    items: [{ ref: 'c', correct: false, cluesUsed: 0, wrongGuesses: 1, points: 0, ms: 1, parts }],
  });

  it('tallies per-piece history, derives a miss focus and picker stats', () => {
    const history = buildVerbLegoHistory([
      round('2026-09-01', [{ key: 'れる|れ', correct: false }, { key: 'た|た', correct: true }]),
      round('2026-09-02', [{ key: 'れる|れ', correct: true }]),
    ]);
    expect(history.get('れる|れ')).toEqual({ attempts: 2, misses: 1 });
    const focus = verbLegoMissFocus(history);
    expect(focus).toEqual(new Map([['れる|れ', 1]]));
    expect(chainStats(chain, history)).toMatchObject({ hasCard: true, lapses: 1 });
    expect(chainStats(chain, new Map()).hasCard).toBe(false);
    expect(describeChainPick('weak', chain, focus)).toMatch(/れ/);
    expect(describeChainPick('any', chain, focus)).toBe('From one of your own sentences.');
    expect(describeChainPick('any', { ...chain, source: 'built' }, focus)).toBe('Built from a verb you know.');
  });
});

import {
  BUILT_RECIPES,
  buildBuiltChain,
  buildVerbLegoCandidates,
  chainMeaning,
  chooseChain,
  functionHelp,
  functionHint,
  recipesForVerb,
  type BuildableVerb,
} from '../src/lib/verbLego';

describe('buildBuiltChain — composed forms match real Japanese', () => {
  const form = (verb: BuildableVerb, recipeId: string) =>
    buildBuiltChain(verb, BUILT_RECIPES.find((r) => r.id === recipeId)!)?.pieces.map((p) => p.text).join('');

  const godan: [BuildableVerb, Record<string, string>][] = [
    [{ expression: '聞く', reading: 'きく', partOfSpeech: 'v5k; vt' }, {
      'causative-past': '聞かせた', 'passive-past': '聞かれた', 'want-past': '聞きたかった',
      'causative-negative': '聞かせない', 'passive-negative': '聞かれない', 'causative-passive': '聞かせられる',
      'causative-negative-past': '聞かせなかった', 'passive-negative-past': '聞かれなかった',
      'causative-passive-past': '聞かせられた', 'causative-passive-negative-past': '聞かせられなかった',
    }],
    [{ expression: '買う', reading: 'かう', partOfSpeech: 'v5u; vt' }, { 'causative-past': '買わせた', 'passive-past': '買われた', 'want-past': '買いたかった' }],
    [{ expression: '読む', reading: 'よむ', partOfSpeech: 'v5m; vt' }, { 'causative-past': '読ませた', 'passive-negative-past': '読まれなかった' }],
    [{ expression: '泳ぐ', reading: 'およぐ', partOfSpeech: 'v5g; vi' }, { 'causative-past': '泳がせた', 'want-past': '泳ぎたかった' }],
    [{ expression: '死ぬ', reading: 'しぬ', partOfSpeech: 'v5n; vi' }, { 'causative-past': '死なせた' }],
    [{ expression: '遊ぶ', reading: 'あそぶ', partOfSpeech: 'v5b; vi' }, { 'causative-past': '遊ばせた', 'want-past': '遊びたかった' }],
    [{ expression: '待つ', reading: 'まつ', partOfSpeech: 'v5t; vt' }, { 'causative-past': '待たせた', 'passive-past': '待たれた' }],
    [{ expression: '話す', reading: 'はなす', partOfSpeech: 'v5s; vt' }, { 'causative-past': '話させた', 'passive-past': '話された', 'want-past': '話したかった' }],
    [{ expression: '帰る', reading: 'かえる', partOfSpeech: 'v5r; vi' }, { 'causative-past': '帰らせた', 'want-past': '帰りたかった' }],
    [{ expression: 'あそぶ', reading: 'あそぶ', partOfSpeech: 'v5b; vi' }, { 'causative-past': 'あそばせた' }],
  ];
  const ichidan: [BuildableVerb, Record<string, string>][] = [
    [{ expression: '食べる', reading: 'たべる', partOfSpeech: 'v1; vt' }, {
      'causative-past': '食べさせた', 'passive-past': '食べられた', 'want-past': '食べたかった',
      'causative-negative': '食べさせない', 'passive-negative': '食べられない', 'causative-passive': '食べさせられる',
      'causative-negative-past': '食べさせなかった', 'passive-negative-past': '食べられなかった',
      'causative-passive-past': '食べさせられた', 'causative-passive-negative-past': '食べさせられなかった',
    }],
    [{ expression: '見る', reading: 'みる', partOfSpeech: 'v1; vt' }, { 'causative-past': '見させた', 'passive-past': '見られた', 'causative-passive-negative-past': '見させられなかった' }],
    [{ expression: 'たべる', reading: 'たべる', partOfSpeech: 'v1; vt' }, { 'causative-past': 'たべさせた' }],
  ];

  for (const [verb, forms] of [...godan, ...ichidan]) {
    it(`${verb.expression}: ${Object.keys(forms).length} recipe(s) compose correctly`, () => {
      for (const [recipeId, expected] of Object.entries(forms)) {
        // a passive recipe needs the transitive tag; give intransitives only the non-passive ones
        if (/passive/.test(recipeId) && !/\bvt\b/.test(verb.partOfSpeech ?? '')) continue;
        expect(form(verb, recipeId), `${verb.expression} ${recipeId}`).toBe(expected);
      }
    });
  }

  it('trusts the JMdict tag over the word’s shape: godan verbs that look ichidan (切る 走る 入る 知る 減る)', () => {
    const cases: [string, string, string][] = [
      ['思い切る', 'おもいきる', '思い切らせない'],
      ['走る', 'はしる', '走らせない'],
      ['入る', 'はいる', '入らせない'],
      ['知る', 'しる', '知らせない'],
      ['減る', 'へる', '減らせない'],
      ['蹴る', 'ける', '蹴らせない'],
    ];
    for (const [expression, reading, expected] of cases) {
      expect(form({ expression, reading, partOfSpeech: 'v5r; vi' }, 'causative-negative'), expression).toBe(expected);
    }
    // …and the same shapes really are ichidan when JMdict says v1
    expect(form({ expression: '寝る', reading: 'ねる', partOfSpeech: 'v1; vi' }, 'causative-negative')).toBe('寝させない');
    expect(form({ expression: '着る', reading: 'きる', partOfSpeech: 'v1; vt' }, 'passive-past')).toBe('着られた');
  });

  it('every built piece has a label, and pieces carry the right keys', () => {
    const chain = buildBuiltChain(
      { expression: '食べる', reading: 'たべる', partOfSpeech: 'v1; vt' },
      BUILT_RECIPES.find((r) => r.id === 'causative-passive-negative-past')!,
    )!;
    expect(chain.pieces.map((p) => p.text)).toEqual(['食べ', 'させ', 'られ', 'なかっ', 'た']);
    expect(chain.pieces.map((p) => p.key)).toEqual(['stem:させる', 'させる|させ', 'られる|られ', 'ない|なかっ', 'た|た']);
    expect(chain.source).toBe('built');
    expect(chain.id).toBe('built:食べる:causative-passive-negative-past');
    expect(chain.pieces.every((p) => p.label.length > 0)).toBe(true);
  });

  it('a built chain makes a valid puzzle whose decoys never equal a correct piece', () => {
    const chain = buildBuiltChain(
      { expression: '聞く', reading: 'きく', partOfSpeech: 'v5k; vt' },
      BUILT_RECIPES.find((r) => r.id === 'causative-passive-negative-past')!,
    )!;
    for (const seed of ['a', 'b', 'c']) {
      const puzzle = buildVerbLegoPuzzle(chain, seed);
      const decoys = puzzle.bank.map((c) => c.text).filter((t) => !puzzle.answers.includes(t));
      expect(decoys).toHaveLength(3);
      // decoy stems are only ever real other stems, never the e-stem
      expect(puzzle.bank.map((c) => c.text)).not.toContain('聞け');
    }
  });
});

describe('recipesForVerb', () => {
  it('needs an explicit transitive tag for anything with a passive; other recipes work without it', () => {
    const intrans = recipesForVerb({ expression: '泳ぐ', reading: 'およぐ', partOfSpeech: 'v5g; vi' });
    expect(intrans.length).toBeGreaterThan(0);
    expect(intrans.some((r) => r.steps.includes('passive'))).toBe(false);
    const trans = recipesForVerb({ expression: '聞く', reading: 'きく', partOfSpeech: 'v5k; vt' });
    expect(trans).toHaveLength(BUILT_RECIPES.length);
  });

  it('refuses statives, irregulars, honorific i-stems, and non-verbs', () => {
    for (const expression of ['ある', 'できる', '分かる', 'する', '来る', 'くださる', '行ける', 'しれる']) {
      expect(recipesForVerb({ expression, reading: expression, partOfSpeech: 'v5r; vt' })).toEqual([]);
    }
    expect(recipesForVerb({ expression: '召し上がる', reading: 'めしあがる', partOfSpeech: 'v5aru; vt' })).toEqual([]);
    expect(recipesForVerb({ expression: '猫', reading: 'ねこ', partOfSpeech: 'n' })).toEqual([]);
    // particle + verb phrases are expressions, not verbs
    for (const expression of ['ことになる', '気にする', 'ことにする', 'ものになる']) {
      expect(recipesForVerb({ expression, reading: expression, partOfSpeech: 'v5r; vi' }), expression).toEqual([]);
    }
    // an untagged word is never guessed into a verb, even one that looks like one
    expect(recipesForVerb({ expression: '食べる', reading: 'たべる' })).toEqual([]);
    expect(recipesForVerb({ expression: '食べる', reading: 'たべる', partOfSpeech: 'adj-i' })).toEqual([]);
  });
});

describe('candidates by pattern', () => {
  it('groups real and built chains sharing a suffix pattern, one candidate per pattern', () => {
    const real = findVerbChains(PASSIVE_PAST)[0]!;
    const built = buildBuiltChain(
      { expression: '食べる', reading: 'たべる', partOfSpeech: 'v1; vt' },
      BUILT_RECIPES.find((r) => r.id === 'passive-past')!,
    )!;
    // 食べ+られ+た has a different aux surface than 聞か+れ+た, so different signatures…
    expect(chainSignature(real)).not.toBe(chainSignature(built));
    const godanBuilt = buildBuiltChain(
      { expression: '読む', reading: 'よむ', partOfSpeech: 'v5m; vt' },
      BUILT_RECIPES.find((r) => r.id === 'passive-past')!,
    )!;
    // …but a godan built passive-past shares the real chain's pattern
    expect(chainSignature(real)).toBe(chainSignature(godanBuilt));
    const candidates = buildVerbLegoCandidates([real, built, godanBuilt], new Map());
    expect(candidates).toHaveLength(2);
    expect(candidates.find((c) => c.id === chainSignature(real))!.chains).toHaveLength(2);
  });

  it('chooseChain is seeded, and can pick either source when both exist', () => {
    const real = findVerbChains(PASSIVE_PAST)[0]!;
    const built = buildBuiltChain(
      { expression: '読む', reading: 'よむ', partOfSpeech: 'v5m; vt' },
      BUILT_RECIPES.find((r) => r.id === 'passive-past')!,
    )!;
    const [candidate] = buildVerbLegoCandidates([real, built], new Map());
    expect(chooseChain(candidate!, 'x')).toEqual(chooseChain(candidate!, 'x'));
    const sources = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => chooseChain(candidate!, s).source));
    expect(sources).toEqual(new Set(['sentence', 'built']));
  });
});

describe('plain-English help', () => {
  const built = (verb: BuildableVerb, recipeId: string) =>
    buildBuiltChain(verb, BUILT_RECIPES.find((r) => r.id === recipeId)!)!;
  const examples = (chain: ReturnType<typeof built>) =>
    Object.fromEntries(functionHelp(chain).map((h) => [h.name, h.example]));

  it('explains each distinct function in order and shows this verb in it', () => {
    const chain = built({ expression: '聞く', reading: 'きく', partOfSpeech: 'v5k; vt' }, 'causative-passive-negative-past');
    expect(functionHelp(chain).map((h) => h.name)).toEqual(['causative', 'passive', 'negative', 'past']);
    expect(examples(chain)).toEqual({ causative: '聞かせる', passive: '聞かれる', negative: '聞かない', past: '聞いた' });
    expect(functionHelp(chain).every((h) => h.meaning.length > 0)).toBe(true);
  });

  it('gets ichidan, want-to and kana-only verbs right', () => {
    expect(examples(built({ expression: '食べる', reading: 'たべる', partOfSpeech: 'v1; vt' }, 'want-past'))).toEqual({
      'want to': '食べたい',
      past: '食べた',
    });
    expect(examples(built({ expression: '食べる', reading: 'たべる', partOfSpeech: 'v1; vt' }, 'causative-past')).causative).toBe('食べさせる');
    expect(examples(built({ expression: 'たべる', reading: 'たべる', partOfSpeech: 'v1; vt' }, 'causative-past'))).toEqual({
      causative: 'たべさせる',
      past: 'たべた',
    });
    expect(examples(built({ expression: 'あそぶ', reading: 'あそぶ', partOfSpeech: 'v5b; vi' }, 'causative-past'))).toEqual({
      causative: 'あそばせる',
      past: 'あそんだ',
    });
  });

  it('trusts the JMdict tag for a godan verb that looks ichidan (切る)', () => {
    const chain = built({ expression: '思い切る', reading: 'おもいきる', partOfSpeech: 'v5r; vi' }, 'causative-past');
    expect(examples(chain)).toEqual({ causative: '思い切らせる', past: '思い切った' });
  });

  it('shows examples for a real chain only when the sentence’s own stem confirms the verb class', () => {
    const trusted = findVerbChains(PASSIVE_PAST)[0]!;
    expect(Object.fromEntries(functionHelp(trusted).map((h) => [h.name, h.example]))).toEqual({
      passive: '聞かれる',
      past: '聞いた',
    });
    // 思い切ら+れ+た: shape alone says ichidan (stem 思い切), which contradicts the real stem → no examples, never wrong ones
    const suspect = findVerbChains(
      sentence([V('思い切ら', '思い切る', 'おもいきる'), A('れ', 'れる'), A('た', 'た')]),
    )[0]!;
    const help = functionHelp(suspect);
    expect(help.map((h) => h.name)).toEqual(['passive', 'past']);
    expect(help.every((h) => h.example === null)).toBe(true);
    expect(help.every((h) => h.meaning.length > 0)).toBe(true); // the meaning is still shown
  });

  it('summarises what a built form means, and nothing for a real chain', () => {
    expect(chainMeaning(built({ expression: '食べる', reading: 'たべる', partOfSpeech: 'v1; vt' }, 'causative-passive-negative-past'))).toBe(
      'wasn’t made to X',
    );
    for (const recipe of BUILT_RECIPES) {
      expect(chainMeaning({ id: `built:食べる:${recipe.id}`, source: 'built' }), recipe.id).toBeTruthy();
    }
    expect(chainMeaning(findVerbChains(PASSIVE_PAST)[0]!)).toBeNull();
  });

  it('has a short hint for every function the game uses', () => {
    expect(functionHint('causative')).toBe('make/let someone');
    expect(functionHint('passive')).toBe('be done to');
    expect(functionHint('nonsense')).toBe('');
    for (const name of ['causative', 'passive', 'negative', 'past', 'polite', 'want to', 'ongoing (〜ている)', 'conditional']) {
      expect(functionHint(name), name).not.toBe('');
    }
  });
});
