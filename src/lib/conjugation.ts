/**
 * Godan/ichidan/suru/kuru/i-adjective/na-adjective conjugation, ported from
 * the archived `anki` repo's `wk_decks.py` (`conjugate_godan` and friends,
 * lines ~2953-3510) for Phase 7.9's sentence-transformation review card
 * (docs/STATUS.md). Validated against the same 86 fixture rows that repo's
 * `conjugation_fixtures.json` used (see tests/conjugation.test.ts).
 *
 * One real difference from the source: word-class detection there read
 * WaniKani-subject `parts_of_speech` strings (e.g. "godan verb"). This app's
 * `VocabularyItem.partOfSpeech` instead holds JMDict tags (e.g. "v5r; vt",
 * "adj-i") from the JMDict-backfill/Anki-import pipelines — see
 * `conjugationWordClassFromPartOfSpeech` below, a new classifier for that
 * data shape rather than a port of the Python one (which doesn't apply
 * here). The conjugation math itself (stem-splitting, suffix tables) is
 * ported as-is.
 */

export type ConjugationWordClass =
  | 'godan'
  | 'ichidan'
  | 'suru'
  | 'kuru'
  | 'i_adjective'
  | 'na_adjective';

export type ConjugationFormKey =
  | 'polite_present'
  | 'polite_negative'
  | 'polite_past'
  | 'polite_past_negative'
  | 'plain_negative'
  | 'plain_past'
  | 'plain_past_negative'
  | 'te_form'
  | 'potential'
  | 'passive'
  | 'causative'
  | 'ba_form'
  | 'tara_form'
  | 'polite';

export interface ConjugationForm {
  key: ConjugationFormKey;
  label: string;
}

const VERB_CONJUGATION_FORMS: ConjugationForm[] = [
  { key: 'polite_present', label: 'Polite present' },
  { key: 'polite_negative', label: 'Polite negative' },
  { key: 'polite_past', label: 'Polite past' },
  { key: 'polite_past_negative', label: 'Polite past negative' },
  { key: 'plain_negative', label: 'Plain negative' },
  { key: 'plain_past', label: 'Plain past' },
  { key: 'plain_past_negative', label: 'Plain past negative' },
  { key: 'te_form', label: 'Te-form' },
  { key: 'potential', label: 'Potential' },
  { key: 'passive', label: 'Passive' },
  { key: 'causative', label: 'Causative' },
  { key: 'ba_form', label: 'Conditional (~ば)' },
  { key: 'tara_form', label: 'Conditional (~たら)' },
];

const ADJECTIVE_CONJUGATION_FORMS: ConjugationForm[] = [
  { key: 'plain_negative', label: 'Plain negative' },
  { key: 'plain_past', label: 'Plain past' },
  { key: 'plain_past_negative', label: 'Plain past negative' },
  { key: 'polite', label: 'Polite' },
  { key: 'polite_negative', label: 'Polite negative' },
  { key: 'polite_past', label: 'Polite past' },
  { key: 'polite_past_negative', label: 'Polite past negative' },
  { key: 'te_form', label: 'Te-form' },
  { key: 'ba_form', label: 'Conditional (~ば)' },
  { key: 'tara_form', label: 'Conditional (~たら)' },
];

export function conjugationFormsForWordClass(
  wordClass: ConjugationWordClass,
): ConjugationForm[] {
  if (wordClass === 'i_adjective' || wordClass === 'na_adjective') {
    return ADJECTIVE_CONJUGATION_FORMS;
  }
  return VERB_CONJUGATION_FORMS;
}

/**
 * Classifies a JMDict-tag `partOfSpeech` string (comma- or
 * semicolon-separated, e.g. "v5r; vt", "n,vs,vi", "adj-i") into a
 * conjugation word class, or null if nothing conjugable is tagged. JMDict's
 * v5* tags (v5u/v5k/v5g/v5s/v5t/v5n/v5b/v5m/v5r/...) all collapse to
 * 'godan' here — the specific row doesn't matter, since conjugation derives
 * the okurigana straight from the reading (see splitWordStems), not from
 * the tag.
 */
export function conjugationWordClassFromPartOfSpeech(
  partOfSpeech: string | undefined,
): ConjugationWordClass | null {
  if (!partOfSpeech) return null;
  const tags = partOfSpeech
    .split(/[,;]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (tags.includes('adj-i')) return 'i_adjective';
  if (tags.includes('adj-na')) return 'na_adjective';
  if (tags.includes('vk')) return 'kuru';
  if (tags.some((tag) => tag === 'vs' || tag === 'vs-i' || tag === 'vs-s')) return 'suru';
  if (tags.includes('v1')) return 'ichidan';
  if (tags.some((tag) => /^v5[a-z]$/.test(tag))) return 'godan';
  return null;
}

export interface ConjugatedForm {
  expression: string;
  reading: string;
}

const HIRAGANA_RE = /^[ぁ-んー]$/;
const KATAKANA_RE = /^[ァ-ヶー]$/;

function isKanaChar(char: string): boolean {
  return HIRAGANA_RE.test(char) || KATAKANA_RE.test(char);
}

function isAllKana(text: string): boolean {
  return text.length > 0 && [...text].every(isKanaChar);
}

function kanaTailLength(expression: string): number {
  let length = 0;
  while (length < expression.length) {
    const char = expression[expression.length - (length + 1)]!;
    if (!isKanaChar(char)) break;
    length += 1;
  }
  return length;
}

const GODAN_POLITE_STEM_SUFFIX: Record<string, string> = {
  う: 'い', く: 'き', ぐ: 'ぎ', す: 'し', つ: 'ち', ぬ: 'に', ぶ: 'び', む: 'み', る: 'り',
};
const GODAN_NEGATIVE_STEM_SUFFIX: Record<string, string> = {
  う: 'わ', く: 'か', ぐ: 'が', す: 'さ', つ: 'た', ぬ: 'な', ぶ: 'ば', む: 'ま', る: 'ら',
};
const GODAN_TE_SUFFIX: Record<string, string> = {
  う: 'って', く: 'いて', ぐ: 'いで', す: 'して', つ: 'って', ぬ: 'んで', ぶ: 'んで', む: 'んで', る: 'って',
};
const GODAN_PAST_SUFFIX: Record<string, string> = {
  う: 'った', く: 'いた', ぐ: 'いだ', す: 'した', つ: 'った', ぬ: 'んだ', ぶ: 'んだ', む: 'んだ', る: 'った',
};
const GODAN_POTENTIAL_SUFFIX: Record<string, string> = {
  う: 'える', く: 'ける', ぐ: 'げる', す: 'せる', つ: 'てる', ぬ: 'ねる', ぶ: 'べる', む: 'める', る: 'れる',
};
const GODAN_E_ROW_SUFFIX: Record<string, string> = {
  う: 'え', く: 'け', ぐ: 'げ', す: 'せ', つ: 'て', ぬ: 'ね', ぶ: 'べ', む: 'め', る: 'れ',
};

const IKU_READING_EXCEPTIONS: Record<string, Partial<Record<ConjugationFormKey, string>>> = {
  いく: {
    polite_present: 'いきます',
    polite_negative: 'いきません',
    polite_past: 'いきました',
    polite_past_negative: 'いきませんでした',
    plain_negative: 'いかない',
    plain_past: 'いった',
    plain_past_negative: 'いかなかった',
    te_form: 'いって',
    potential: 'いける',
    passive: 'いかれる',
    causative: 'いかせる',
    ba_form: 'いけば',
    tara_form: 'いったら',
  },
};

interface WordStems {
  charStem: string;
  readingStem: string;
  okurigana: string;
}

/** Splits a dictionary-form (expression, reading) into (character stem, reading stem, okurigana). */
function splitWordStems(expression: string, reading: string): WordStems | null {
  if (!expression || !reading) return null;

  if (isAllKana(expression)) {
    if (reading.endsWith('する') && expression.endsWith('する')) {
      return {
        charStem: expression.slice(0, -2),
        readingStem: reading.slice(0, -2),
        okurigana: 'する',
      };
    }
    if ((reading === 'する' || reading === 'くる') && expression === reading) {
      return { charStem: '', readingStem: reading, okurigana: expression };
    }
    return { charStem: expression, readingStem: reading, okurigana: '' };
  }

  if (
    expression.endsWith('する') &&
    reading.endsWith('する') &&
    expression.length >= 2 &&
    reading.length >= 2
  ) {
    return {
      charStem: expression.slice(0, -2),
      readingStem: reading.slice(0, -2),
      okurigana: 'する',
    };
  }
  if (
    expression.endsWith('る') &&
    reading.endsWith('る') &&
    expression.length >= 2 &&
    reading.length >= 2
  ) {
    return {
      charStem: expression.slice(0, -1),
      readingStem: reading.slice(0, -1),
      okurigana: 'る',
    };
  }

  const kanaLen = kanaTailLength(expression);
  if (kanaLen === 0) return null;
  const okurigana = expression.slice(expression.length - kanaLen);
  const charStem = expression.slice(0, expression.length - kanaLen);
  if (okurigana && reading.endsWith(okurigana)) {
    return {
      charStem,
      readingStem: reading.slice(0, reading.length - okurigana.length),
      okurigana,
    };
  }
  if (okurigana.length === 1 && okurigana in GODAN_POLITE_STEM_SUFFIX && reading.length >= 2) {
    return { charStem, readingStem: reading.slice(0, -1), okurigana };
  }
  return null;
}

function surfaceFromReadingStems(
  charStem: string,
  readingStem: string,
  conjugatedReading: string,
): string {
  if (conjugatedReading.startsWith(readingStem)) {
    return charStem + conjugatedReading.slice(readingStem.length);
  }
  if (isAllKana(charStem + readingStem)) {
    return conjugatedReading;
  }
  return charStem + conjugatedReading.slice(readingStem.length);
}

function conjugateGodan(
  expression: string,
  reading: string,
  formKey: ConjugationFormKey,
): ConjugatedForm | null {
  const ikuException = IKU_READING_EXCEPTIONS[reading]?.[formKey];
  if (ikuException) {
    const stems = splitWordStems(expression, reading);
    if (!stems) return null;
    return {
      expression: surfaceFromReadingStems(stems.charStem, stems.readingStem, ikuException),
      reading: ikuException,
    };
  }

  const stems = splitWordStems(expression, reading);
  if (!stems) return null;
  const { charStem, readingStem, okurigana } = stems;
  if (okurigana.length !== 1 || !(okurigana in GODAN_POLITE_STEM_SUFFIX)) return null;

  let conjugatedReading: string;
  switch (formKey) {
    case 'polite_present':
      conjugatedReading = readingStem + GODAN_POLITE_STEM_SUFFIX[okurigana] + 'ます';
      break;
    case 'polite_negative':
      conjugatedReading = readingStem + GODAN_POLITE_STEM_SUFFIX[okurigana] + 'ません';
      break;
    case 'polite_past':
      conjugatedReading = readingStem + GODAN_POLITE_STEM_SUFFIX[okurigana] + 'ました';
      break;
    case 'polite_past_negative':
      conjugatedReading = readingStem + GODAN_POLITE_STEM_SUFFIX[okurigana] + 'ませんでした';
      break;
    case 'plain_negative':
      conjugatedReading = readingStem + GODAN_NEGATIVE_STEM_SUFFIX[okurigana] + 'ない';
      break;
    case 'plain_past':
      conjugatedReading = readingStem + GODAN_PAST_SUFFIX[okurigana];
      break;
    case 'plain_past_negative':
      conjugatedReading = readingStem + GODAN_NEGATIVE_STEM_SUFFIX[okurigana] + 'なかった';
      break;
    case 'te_form':
      conjugatedReading = readingStem + GODAN_TE_SUFFIX[okurigana];
      break;
    case 'potential':
      conjugatedReading = readingStem + GODAN_POTENTIAL_SUFFIX[okurigana];
      break;
    case 'passive':
      conjugatedReading = readingStem + GODAN_NEGATIVE_STEM_SUFFIX[okurigana] + 'れる';
      break;
    case 'causative':
      conjugatedReading = readingStem + GODAN_NEGATIVE_STEM_SUFFIX[okurigana] + 'せる';
      break;
    case 'ba_form':
      conjugatedReading = readingStem + GODAN_E_ROW_SUFFIX[okurigana] + 'ば';
      break;
    case 'tara_form':
      conjugatedReading = readingStem + GODAN_PAST_SUFFIX[okurigana] + 'ら';
      break;
    default:
      return null;
  }
  return {
    expression: surfaceFromReadingStems(charStem, readingStem, conjugatedReading),
    reading: conjugatedReading,
  };
}

function conjugateIchidan(
  expression: string,
  reading: string,
  formKey: ConjugationFormKey,
): ConjugatedForm | null {
  const stems = splitWordStems(expression, reading);
  if (!stems || stems.okurigana !== 'る' || !reading.endsWith('る')) return null;
  const { charStem, readingStem } = stems;

  let conjugatedReading: string;
  switch (formKey) {
    case 'polite_present': conjugatedReading = readingStem + 'ます'; break;
    case 'polite_negative': conjugatedReading = readingStem + 'ません'; break;
    case 'polite_past': conjugatedReading = readingStem + 'ました'; break;
    case 'polite_past_negative': conjugatedReading = readingStem + 'ませんでした'; break;
    case 'plain_negative': conjugatedReading = readingStem + 'ない'; break;
    case 'plain_past': conjugatedReading = readingStem + 'た'; break;
    case 'plain_past_negative': conjugatedReading = readingStem + 'なかった'; break;
    case 'te_form': conjugatedReading = readingStem + 'て'; break;
    case 'potential': conjugatedReading = readingStem + 'られる'; break;
    case 'passive': conjugatedReading = readingStem + 'られる'; break;
    case 'causative': conjugatedReading = readingStem + 'させる'; break;
    case 'ba_form': conjugatedReading = readingStem + 'れば'; break;
    case 'tara_form': conjugatedReading = readingStem + 'たら'; break;
    default: return null;
  }
  return {
    expression: surfaceFromReadingStems(charStem, readingStem, conjugatedReading),
    reading: conjugatedReading,
  };
}

const SURU_FORMS: Partial<Record<ConjugationFormKey, string>> = {
  polite_present: 'します',
  polite_negative: 'しません',
  polite_past: 'しました',
  polite_past_negative: 'しませんでした',
  plain_negative: 'しない',
  plain_past: 'した',
  plain_past_negative: 'しなかった',
  te_form: 'して',
  potential: 'できる',
  passive: 'される',
  causative: 'させる',
  ba_form: 'すれば',
  tara_form: 'したら',
};

function conjugateSuru(
  expression: string,
  reading: string,
  formKey: ConjugationFormKey,
): ConjugatedForm | null {
  let charStem: string;
  let readingStem: string;
  if (reading.endsWith('する')) {
    charStem = expression.endsWith('する') ? expression.slice(0, -2) : expression;
    readingStem = reading.slice(0, -2);
  } else if (reading === 'する' && expression === 'する') {
    charStem = '';
    readingStem = '';
  } else {
    return null;
  }

  const suffix = SURU_FORMS[formKey];
  if (!suffix) return null;
  // The Python source's expression-building branches all reduce to this —
  // see the module doc comment for why (dead-code elimination during port).
  return {
    expression: charStem ? charStem + suffix : suffix,
    reading: readingStem + suffix,
  };
}

const KURU_FORMS: Partial<Record<ConjugationFormKey, ConjugatedForm>> = {
  polite_present: { expression: '来ます', reading: 'きます' },
  polite_negative: { expression: '来ません', reading: 'きません' },
  polite_past: { expression: '来ました', reading: 'きました' },
  polite_past_negative: { expression: '来ませんでした', reading: 'きませんでした' },
  plain_negative: { expression: '来ない', reading: 'こない' },
  plain_past: { expression: '来た', reading: 'きた' },
  plain_past_negative: { expression: '来なかった', reading: 'こなかった' },
  te_form: { expression: '来て', reading: 'きて' },
  potential: { expression: '来られる', reading: 'こられる' },
  passive: { expression: '来られる', reading: 'こられる' },
  causative: { expression: '来させる', reading: 'こさせる' },
  ba_form: { expression: '来れば', reading: 'くれば' },
  tara_form: { expression: '来たら', reading: 'きたら' },
};

function conjugateKuru(
  expression: string,
  reading: string,
  formKey: ConjugationFormKey,
): ConjugatedForm | null {
  if (reading !== 'くる' || (expression !== '来る' && expression !== 'くる')) return null;
  return KURU_FORMS[formKey] ?? null;
}

const I_ADJECTIVE_IRREGULAR_FORMS: Partial<Record<ConjugationFormKey, string>> = {
  plain_negative: 'よくない',
  plain_past: 'よかった',
  plain_past_negative: 'よくなかった',
  polite: 'いいです',
  polite_negative: 'よくないです',
  polite_past: 'よかったです',
  polite_past_negative: 'よくなかったです',
  te_form: 'よくて',
  ba_form: 'よければ',
  tara_form: 'よかったら',
};

const I_ADJECTIVE_SUFFIXES: Partial<Record<ConjugationFormKey, string>> = {
  plain_negative: 'くない',
  plain_past: 'かった',
  plain_past_negative: 'くなかった',
  polite: 'いです',
  polite_negative: 'くないです',
  polite_past: 'かったです',
  polite_past_negative: 'くなかったです',
  te_form: 'くて',
  ba_form: 'ければ',
  tara_form: 'かったら',
};

function conjugateIAdjective(
  expression: string,
  reading: string,
  formKey: ConjugationFormKey,
): ConjugatedForm | null {
  if (reading === 'いい' || reading === 'よい') {
    const form = I_ADJECTIVE_IRREGULAR_FORMS[formKey];
    return form ? { expression: form, reading: form } : null;
  }
  if (!reading.endsWith('い') || !expression.endsWith('い')) return null;

  const suffix = I_ADJECTIVE_SUFFIXES[formKey];
  if (!suffix) return null;
  return {
    expression: expression.slice(0, -1) + suffix,
    reading: reading.slice(0, -1) + suffix,
  };
}

const NA_ADJECTIVE_SUFFIXES: Partial<Record<ConjugationFormKey, string>> = {
  plain_negative: 'じゃない',
  plain_past: 'だった',
  plain_past_negative: 'じゃなかった',
  polite: 'です',
  polite_negative: 'じゃないです',
  polite_past: 'でした',
  polite_past_negative: 'じゃなかったです',
  te_form: 'で',
  ba_form: 'なら',
  tara_form: 'だったら',
};

function conjugateNaAdjective(
  expression: string,
  reading: string,
  formKey: ConjugationFormKey,
): ConjugatedForm | null {
  const suffix = NA_ADJECTIVE_SUFFIXES[formKey];
  if (!suffix) return null;
  return { expression: expression + suffix, reading: reading + suffix };
}

/**
 * The inverse of `conjugate`: given a dictionary form and the exact
 * inflected text of one of its occurrences in a sentence, work out which
 * conjugation form that occurrence is — by conjugating the dictionary form
 * to every form the word class offers and seeing which one the surface
 * reproduces. Used by the contextual conjugation review card (per-occurrence
 * `sentence_transformation`, docs/STATUS.md) so a verb is only ever quizzed
 * on a form it has actually been read in.
 *
 * A form matches when either the conjugated `expression` equals
 * `surfaceExpression` or (when given) the conjugated `reading` equals
 * `surfaceReading` — the reading path covers a sentence writing a
 * normally-kanji verb in kana (dict 話す, surface はなして).
 *
 * Returns null when:
 * - the surface just *is* the dictionary expression (nothing was conjugated), or
 * - no form matches (a stacked/compound surface like 話している,
 *   食べられなかった, 〜てしまった — those aren't a single form this engine
 *   produces, and are deliberately left un-quizzed).
 *
 * When several form keys match (e.g. ichidan potential and passive both give
 * 食べられる) the first in `conjugationFormsForWordClass` order wins — the
 * conjugated string is identical, so the distinction is academic for a
 * type-the-reading card.
 */
export function identifyConjugationForm(
  expression: string,
  reading: string,
  wordClass: ConjugationWordClass,
  surfaceExpression: string,
  surfaceReading?: string,
): { form: ConjugationForm } | null {
  if (!expression || !reading || !surfaceExpression) return null;
  if (surfaceExpression === expression) return null;
  for (const form of conjugationFormsForWordClass(wordClass)) {
    const conjugated = conjugate(expression, reading, wordClass, form.key);
    if (!conjugated) continue;
    if (
      conjugated.expression === surfaceExpression ||
      (!!surfaceReading && conjugated.reading === surfaceReading)
    ) {
      if (
        conjugated.expression === expression &&
        conjugated.reading === reading
      ) {
        continue;
      }
      return { form };
    }
  }
  return null;
}

export function conjugate(
  expression: string,
  reading: string,
  wordClass: ConjugationWordClass,
  formKey: ConjugationFormKey,
): ConjugatedForm | null {
  if (!expression || !reading) return null;
  switch (wordClass) {
    case 'godan': return conjugateGodan(expression, reading, formKey);
    case 'ichidan': return conjugateIchidan(expression, reading, formKey);
    case 'suru': return conjugateSuru(expression, reading, formKey);
    case 'kuru': return conjugateKuru(expression, reading, formKey);
    case 'i_adjective': return conjugateIAdjective(expression, reading, formKey);
    case 'na_adjective': return conjugateNaAdjective(expression, reading, formKey);
    default: return null;
  }
}
