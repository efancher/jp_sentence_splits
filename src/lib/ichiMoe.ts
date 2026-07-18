import { ICHI_MOE_BASE } from '../appConfig';

export function ichiMoeUrl(japanese: string): string {
  const query = encodeURIComponent(japanese);
  return `${ICHI_MOE_BASE}?q=${query}&r=kana`;
}
