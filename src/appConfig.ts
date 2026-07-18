/**
 * Central application identity and deployment configuration.
 * Change the product name and related labels here only.
 */
export const APP_NAME = 'Satori Glossbook';
export const APP_SHORT_NAME = 'Glossbook';
export const APP_VERSION = '0.3.0';
export const APP_DESCRIPTION =
  'Offline analysis workspace for Japanese sentences from Satori Reader CSV exports.';

/** GitHub Pages project-site base path for this repository. */
export const DEPLOY_BASE = '/jp_sentence_splits/';

export const DB_NAME = 'satori-glossbook';
export const BACKUP_FORMAT_VERSION = 1;
export const ANALYSIS_FORMAT_VERSION = 1;

export const AUTOSAVE_DEBOUNCE_MS = 450;
export const TOUCH_TARGET_MIN_PX = 44;

export const ICHI_MOE_BASE = 'https://ichi.moe/cl/qr/';

export const WORKSHEET_SEPARATORS = {
  chunk: ' ',
  role: ' | ',
  lit: ' · ',
} as const;

/**
 * Cure Dolly–style role vocabulary, grouped for the Analyze role dropdown.
 * Includes every value the role heuristic can emit so suggestions always
 * resolve to a preset; free-form roles remain possible via "Custom…".
 */
export const ROLE_PRESET_GROUPS = [
  {
    label: 'Core cars',
    roles: [
      'Aが',
      'zero-が (∅ subject)',
      'を-car',
      'に-car',
      'で-car',
      'へ-car',
      'と-car',
      'から-car',
      'まで-car',
      'より-car',
      'の-car',
    ],
  },
  {
    label: 'Topic & focus',
    roles: [
      'topic は',
      'も-car',
      'や-car',
      'で-car + topic は',
      'に-car + topic は',
      'へ-car + topic は',
      'と-car + topic は',
    ],
  },
  {
    label: 'Engines',
    roles: [
      'engine',
      'engine: verb',
      'engine: い-adjective',
      'engine: だ/です (copula)',
    ],
  },
  {
    label: 'Connectors & clauses',
    roles: [
      'て-car',
      'ので (because)',
      'のに (although)',
      'clause connector',
      'relative clause',
      'quotation と',
      'nominalizer + topic は',
      'nominalizer + Aが',
      'nominalizer + を-car',
    ],
  },
  {
    label: 'More particles',
    roles: [
      'だけ-car',
      'しか-car',
      'ほど-car',
      'など-car',
      'とか-car',
      'でも-car',
      'ても-car',
      'ては-car',
      'のも-car',
      'って-car',
      'たら-car',
      'たり-car',
      'なら-car',
    ],
  },
  {
    label: 'Other',
    roles: ['time', 'adverb', 'modifier/content', 'sentence ending'],
  },
] as const;

export const ROLE_PRESETS: readonly string[] = ROLE_PRESET_GROUPS.flatMap(
  (group) => [...group.roles],
);
