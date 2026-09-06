/**
 * Splits `japanese` around the first occurrence of `surfaceForm`, for
 * highlighting the word under test in a sentence (`<mark>` the middle
 * element). Returns `[japanese, '', '']` when the surface form isn't
 * present, so callers can render the sentence unchanged.
 */
export function splitOnSurfaceForm(
  japanese: string,
  surfaceForm: string,
): [string, string, string] {
  const index = surfaceForm ? japanese.indexOf(surfaceForm) : -1;
  if (index === -1) return [japanese, '', ''];
  return [
    japanese.slice(0, index),
    surfaceForm,
    japanese.slice(index + surfaceForm.length),
  ];
}
