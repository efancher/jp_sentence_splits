/**
 * Per-entry guards for text-based grammar detection (`buildGrammarDetector`). A short fixed text can sit inside
 * something that is not the pattern (ないで in ないです, らしい in 素晴らしい, に+して from する). Each guard sees the
 * text around a candidate match and returns true to reject it; the detector then tries the next occurrence.
 * Found by auditing real sentences with `npm run diagnose:grammar-detection`, so add an entry only for a measured
 * over-match, and prefer rejecting (a missed pattern stays "unseen") over loose accepting.
 */
export interface MatchContext {
  /** Sentence text before the match. */
  before: string;
  /** The matched span, first segment start through last segment end. */
  matched: string;
  /** Sentence text after the match. */
  after: string;
}

export type DetectionGuard = (context: MatchContext) => boolean;

const APPROX_BEFORE = /([0-9０-９一二三四五六七八九十百千万半]|分|時|円|度|年|個|人|歳|回|前|後|間|日|月|週|キロ|倍)$/;

/**
 * Entries whose fixed text is under the 3-character minimum but precise enough to detect (measured with
 * `npm run diagnose:grammar-short`): content-like endings that rarely sit inside other words. Particle-sized forms
 * (こと, って, とか, とは, なり, まい) stay out: they match far too often.
 */
export const SHORT_LITERAL_FORMS: Readonly<Record<string, readonly string[]>> = {
  sae: ['さえ'],
  koso: ['こそ'],
  hodo: ['ほど'],
  buri: ['ぶり'],
  mama: ['まま'],
  gachi: ['がち'],
  kke: ['っけ'],
  'zu-ni': ['ずに'],
  shidai: ['次第'],
  'baai-wa': ['場合'],
  'muki-muke': ['向き', '向け'],
};

export const DETECTION_GUARDS: Readonly<Record<string, DetectionGuard>> = {
  // ないです / ないでしょう, which are the polite 〜ない, not 〜ないで.
  naide: ({ after }) => /^(す|しょう)/.test(after),
  // 素晴らしい, 誇らしい and friends are い-adjectives that merely end in らしい.
  'rashii-typical-of': ({ before }) => /(素晴|すば|誇|愛|憎|珍|初々|若々|腹立た|晴)$/.test(before),
  // に + する (大切にしています), not the N1 〜にして.
  'ni-shite': ({ after }) => /^(い|て|くだ|お[きくけ]|み|ま|る|た|ほし)/.test(after),
  // Only the "too much" sense: 〜のあまり(に) / あまりに / あまりの, not あまり + a negative.
  'amari-ni': ({ before, after }) => !/^[にの]/.test(after) && !/[のるたい]$/.test(before),
  // Only the emotion-adjective sense (驚いたことに), not the noun こと + に.
  'koto-ni-wa': ({ before }) =>
    !/(驚いた|嬉しい|うれしい|残念な|不思議な|面白い|困った|悲しい|幸いな|意外な|ありがたい|驚くべき|おかしな|悔しい)$/.test(before),
  // Contrastive 〜ものを closes the clause; noun もの + を does not.
  'mono-o': ({ after }) => !/^([、。！？…]|$)/.test(after),
  // もので after a noun-modifying な, or inside ものでは/ものでも, is the noun もの.
  'mono-dakara-mono-de': ({ before, matched, after }) =>
    matched.endsWith('もので') && (/な$/.test(before) || /^[はもす]/.test(after)),
  // 〜なかった after a verb is the plain negative, not the い-adjective 〜かった.
  'ku-nai-katta-ku-nakatta': ({ before, matched }) => matched === 'かった' && /な$/.test(before),
  // ましたって / でしたって quote what was said.
  'tatte-datte': ({ before, matched }) => matched === 'たって' && /(まし|でし)$/.test(before),
  // もう + a past-tense verb close together, in one clause; みたい / たい also contain た.
  'mou-ta': ({ matched, after }) => matched.length > 12 || matched.includes('みたい') || /[、。」「]|一度/.test(matched) || (matched.endsWith('た') && after.startsWith('い')),
  // お + a short verbal noun + する; お金 / お腹 and long gaps are other words.
  'o-suru': ({ matched }) => matched.length > 8 || /^お[金腹]/.test(matched),
  'o-ni-naru': ({ matched }) => matched.length > 8 || /^お[金腹]/.test(matched),
  // Shared forms: every owner needs a guard that rejects the other senses, or the form is skipped.
  // ながら + も is the concessive sense; 残念ながら and friends are fixed adverbs, neither sense.
  nagara: ({ before, after }) => after.startsWith('も') || /(残念|しかし|当然|及ばず)$/.test(before),
  'nagara-mo': ({ after }) => !/^も/.test(after),
  // くらい / ぐらい after a number or time word is "about"; after a verb or adjective it is the extent sense.
  'kurai-gurai': ({ before }) => !APPROX_BEFORE.test(before),
  'kurai-gurai-extent': ({ before }) => !/[るたいう]$/.test(before),
  // ようこそ is the greeting, not 〜こそ.
  koso: ({ before }) => /よう$/.test(before),
  // 〜に向けて is "toward", not 〜向け.
  'muki-muke': ({ after }) => /^[てるた]/.test(after),
  // 〜がち follows a verb stem; が + ちょっと is the subject particle.
  gachi: ({ after }) => /^ょ/.test(after),
};
