import { describe, expect, it } from 'vitest';

import { parseWiktionaryAccentHtml } from '../scripts/backfill-pitch-accent-wiktionary';

// Minimal shape of a real Wiktionary Pronunciation-section entry — the
// accent-underline overlay is a nested <span> around one mora, same as the
// live page structure this pattern was verified against (docs/STATUS.md
// 2026-09-12: 走る/買う/食べる/開ける/高い/甘い).
function pronunciationEntry(kana: string, underlineAfterIndex: number, romaji: string, label: string, position: number) {
  const before = kana.slice(0, underlineAfterIndex);
  const under = kana.slice(underlineAfterIndex, underlineAfterIndex + 1);
  const after = kana.slice(underlineAfterIndex + 1);
  return `<span lang="ja" class="Jpan">${before}<span style="border-top:1px solid;">${under}</span>${after}</span> <span class="Latn"><samp>[${romaji}]</samp></span> (<a href="/wiki/x" title="x">${label}</a> – [${position}])`;
}

describe('parseWiktionaryAccentHtml', () => {
  it('finds the position for a heiban word', () => {
    const html = `<html>${pronunciationEntry('かう', 1, 'kàú', 'Heiban', 0)}</html>`;
    expect(parseWiktionaryAccentHtml(html, 'かう')).toEqual({ kind: 'found', position: 0 });
  });

  it('finds the position for an accented word, including a ꜜ mark inside the romaji', () => {
    const html = `<html>${pronunciationEntry('はしる', 1, 'hàshíꜜrù', 'Nakadaka', 2)}</html>`;
    expect(parseWiktionaryAccentHtml(html, 'はしる')).toEqual({ kind: 'found', position: 2 });
  });

  it('finds the position when the moraic ん is marked with an acute-n (ń), not just grave (ǹ)', () => {
    // ぞんじる's real romaji is [zòńjíꜜrù] — an earlier draft's character
    // class only had ǹ and silently failed to match this shape at all.
    const html = `<html>${pronunciationEntry('ぞんじる', 2, 'zòńjíꜜrù', 'Nakadaka', 3)}</html>`;
    expect(parseWiktionaryAccentHtml(html, 'ぞんじる')).toEqual({ kind: 'found', position: 3 });
  });

  it('resolves a multi-reading page by matching the target reading, not just any accent entry', () => {
    // 開ける-shaped page: あける [0], ひらける [3], and はだける both [3] and
    // [0] for two different senses — only the あける entry should match.
    const html = `<html>
      ${pronunciationEntry('あける', 1, 'àkérú', 'Heiban', 0)}
      ${pronunciationEntry('ひらける', 2, 'hìrákéꜜrù', 'Nakadaka', 3)}
      ${pronunciationEntry('はだける', 2, 'hàdákéꜜrù', 'Nakadaka', 3)}
    </html>`;
    expect(parseWiktionaryAccentHtml(html, 'あける')).toEqual({ kind: 'found', position: 0 });
    expect(parseWiktionaryAccentHtml(html, 'ひらける')).toEqual({ kind: 'found', position: 3 });
  });

  it('returns ambiguous when the target reading itself has more than one cited position', () => {
    const html = `<html>
      ${pronunciationEntry('たかい', 1, 'tàkáꜜì', 'Nakadaka', 2)}
      ${pronunciationEntry('たかい', 0, 'táꜜkàì', 'Atamadaka', 1)}
    </html>`;
    expect(parseWiktionaryAccentHtml(html, 'たかい')).toEqual({ kind: 'ambiguous', positions: [2, 1] });
  });

  it('returns not-found when the page has accent data, but none for the target reading', () => {
    const html = `<html>${pronunciationEntry('ひらける', 2, 'hìrákéꜜrù', 'Nakadaka', 3)}</html>`;
    expect(parseWiktionaryAccentHtml(html, 'あける')).toEqual({ kind: 'not-found' });
  });

  it('returns not-found when the page has no accent-tagged pronunciation at all', () => {
    const html = `<html>no pronunciation section here</html>`;
    expect(parseWiktionaryAccentHtml(html, 'あける')).toEqual({ kind: 'not-found' });
  });

  it('returns no-page for a redirect, rather than reading the redirect target as this word', () => {
    const html = `<html><script>RLCONF={"wgIsRedirect":true};</script>${pronunciationEntry('かう', 1, 'kàú', 'Heiban', 0)}</html>`;
    expect(parseWiktionaryAccentHtml(html, 'かう')).toEqual({ kind: 'no-page' });
  });
});
