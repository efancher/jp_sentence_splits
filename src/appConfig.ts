/**
 * Central application identity and deployment configuration.
 * Change the product name and related labels here only.
 */
export const APP_NAME = 'Satori Glossbook';
export const APP_SHORT_NAME = 'Glossbook';
export const APP_VERSION = '0.6.0';
export const APP_DESCRIPTION =
  'Offline analysis workspace for Japanese sentences from Satori Reader CSV exports.';

/** GitHub Pages project-site base path for this repository. */
export const DEPLOY_BASE = '/jp_sentence_splits/';

export const DB_NAME = 'satori-glossbook';
export const BACKUP_FORMAT_VERSION = 1;
/**
 * Bumped when vocabularySelections / vocabularyReviewStatus were added (2),
 * then again when grammarSuggestions (grammar-learning system) was added (3).
 */
export const ANALYSIS_FORMAT_VERSION = 3;

export const AUTOSAVE_DEBOUNCE_MS = 450;
export const TOUCH_TARGET_MIN_PX = 44;

export const ICHI_MOE_BASE = 'https://ichi.moe/cl/qr/';

/**
 * Tailnet-only forced-alignment service (docs/STATUS.md Phase 9,
 * Milestone 2a) — unreachable off the user's Tailscale tailnet regardless
 * of who can read this constant, so it's not a secret and doesn't need to
 * be an env var (same reasoning as ICHI_MOE_BASE above).
 */
export const SHADOWING_ANALYSIS_API_BASE =
  'https://codex-dev.tailfbd89c.ts.net/shadowing-analysis';

/** Speaking-rate presets for the device text-to-speech settings. */
export const TTS_RATE_PRESETS = [
  { value: 0.6, label: 'Very slow (0.6×)' },
  { value: 0.75, label: 'Slow (0.75×)' },
  { value: 0.9, label: 'Slightly slow (0.9×)' },
  { value: 1.0, label: 'Normal (1.0×)' },
  { value: 1.1, label: 'Slightly fast (1.1×)' },
] as const;

/** Sample sentence used by the Settings "Test voice" button. */
export const TTS_TEST_SENTENCE = '暖かい春がやって来ました。';

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
