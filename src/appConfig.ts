/**
 * Central application identity and deployment configuration.
 * Change the product name and related labels here only.
 */
export const APP_NAME = 'Satori Glossbook';
export const APP_SHORT_NAME = 'Glossbook';
export const APP_VERSION = '0.2.0';
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

export const ROLE_PRESETS = [
  'topic は',
  'Aが',
  'を-car',
  'に-car',
  'で-car',
  'と-car',
  'へ-car',
  'の-car',
  'も-car',
  'から-car',
  'まで-car',
  'て-car',
  'time',
  'modifier/content',
  'clause connector',
  'engine',
  'sentence ending',
  'custom',
] as const;
