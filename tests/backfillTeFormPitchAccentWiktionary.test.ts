import { describe, expect, it } from 'vitest';

import {
  extractTeFormAccentPosition,
  parseKanaCellPosition,
} from '../scripts/backfill-te-form-pitch-accent-wiktionary';

// Mirrors the real Pronunciation-section entry shape (same helper style as
// tests/backfillPitchAccentWiktionary.test.ts).
function pronunciationEntry(kana: string, underlineAfterIndex: number, romaji: string, label: string, position: number) {
  const before = kana.slice(0, underlineAfterIndex);
  const under = kana.slice(underlineAfterIndex, underlineAfterIndex + 1);
  const after = kana.slice(underlineAfterIndex + 1);
  return `<span lang="ja" class="Jpan">${before}<span style="border-top:1px solid;">${under}</span>${after}</span> <span class="Latn"><samp>[${romaji}]</samp></span> (<a href="/wiki/x" title="x">${label}</a> – [${position}])`;
}

// Mirrors the real "Extended conjugation" table's Conjunctive (te-form) row.
// `marker` true inserts the nested absolute-positioned empty span right
// after `prefix + underlined`'s first part — real pages put it directly
// after the specific mora the drop lands on.
function conjunctiveRow(kanji: string, prefix: string, underlined: string, marker: boolean, suffix: string, romaji: string) {
  const markerSpan = marker ? '<span style="position:absolute;top:0;bottom:67%;right:0%;border-right:1px solid;"></span>' : '';
  return `<tr>
<th>Conjunctive
</th>
<td><span class="Jpan" lang="ja">${kanji}</span>
</td>
<td><span lang="ja" class="Jpan">${prefix}<span style="border-top:1px solid;position:relative;padding:1px;">${underlined}${markerSpan}</span>${suffix}</span>
</td>
<td><span class="Latn"><samp>[${romaji}]</samp></span>
</td></tr>`;
}

describe('parseKanaCellPosition', () => {
  it('returns position 0 (heiban) when there is no nested marker span', () => {
    const cell = '<span lang="ja" class="Jpan">か<span style="border-top:1px solid;">って</span></span>';
    expect(parseKanaCellPosition(cell)).toEqual({ kind: 'found', position: 0 });
  });

  it('finds the drop position from the nested marker, counting a prefix outside the underline span', () => {
    // 走って-shaped: は (prefix) + し (underlined, marker right after) + って (suffix) -> position 2.
    const cell =
      '<span lang="ja" class="Jpan">は<span style="border-top:1px solid;">し<span style="position:absolute;border-right:1px solid;"></span></span>って</span>';
    expect(parseKanaCellPosition(cell)).toEqual({ kind: 'found', position: 2 });
  });

  it('finds the drop position with no prefix (marker at the very start of the underline span)', () => {
    // 食べて-shaped: no prefix + た (underlined, marker right after) + べて (suffix) -> position 1.
    const cell =
      '<span lang="ja" class="Jpan"><span style="border-top:1px solid;">た<span style="position:absolute;border-right:1px solid;"></span></span>べて</span>';
    expect(parseKanaCellPosition(cell)).toEqual({ kind: 'found', position: 1 });
  });

  it('returns not-found when the cell has no border-top underline span at all (unexpected structure)', () => {
    expect(parseKanaCellPosition('<span lang="ja" class="Jpan">かって</span>')).toEqual({ kind: 'not-found' });
  });
});

describe('extractTeFormAccentPosition', () => {
  it('finds the te-form position for a heiban word', () => {
    const html = `<html>${pronunciationEntry('かう', 1, 'kàú', 'Heiban', 0)}
      ${conjunctiveRow('買って', 'か', 'って', false, '', 'kàtté')}
    </html>`;
    expect(extractTeFormAccentPosition(html, 'かう')).toEqual({ kind: 'found', position: 0 });
  });

  it('finds a retracted te-form position for an accented word (no citation-position carry-forward)', () => {
    // 食べる citation position 2, but its te-form retracts to position 1.
    const html = `<html>${pronunciationEntry('たべる', 2, 'tàbéꜜrù', 'Nakadaka', 2)}
      ${conjunctiveRow('食べて', '', 'た', true, 'べて', 'táꜜbètè')}
    </html>`;
    expect(extractTeFormAccentPosition(html, 'たべる')).toEqual({ kind: 'found', position: 1 });
  });

  it('finds a non-retracted te-form position for an accented word', () => {
    const html = `<html>${pronunciationEntry('はしる', 1, 'hàshíꜜrù', 'Nakadaka', 2)}
      ${conjunctiveRow('走って', 'は', 'し', true, 'って', 'hàshíꜜttè')}
    </html>`;
    expect(extractTeFormAccentPosition(html, 'はしる')).toEqual({ kind: 'found', position: 2 });
  });

  it('resolves a multi-reading page by anchoring on the matching citation, not the first Conjunctive row', () => {
    // 開ける-shaped: あける (heiban) and ひらける (retracts) share a page —
    // each reading's own Conjunctive row must resolve independently.
    const html = `<html>${pronunciationEntry('あける', 1, 'àkérú', 'Heiban', 0)}
      ${conjunctiveRow('開けて', 'あ', 'けて', false, '', 'àkété')}
      ${pronunciationEntry('ひらける', 3, 'hìrákéꜜrù', 'Nakadaka', 3)}
      ${conjunctiveRow('開けて', 'ひらけ', '', true, 'て', 'hìráꜜkètè')}
    </html>`;
    expect(extractTeFormAccentPosition(html, 'あける')).toEqual({ kind: 'found', position: 0 });
    expect(extractTeFormAccentPosition(html, 'ひらける')).toEqual({ kind: 'found', position: 3 });
  });

  it('returns not-found when there is no citation anchor for the target reading', () => {
    const html = `<html>${pronunciationEntry('ひらける', 2, 'hìrákéꜜrù', 'Nakadaka', 3)}
      ${conjunctiveRow('開けて', 'ひらけ', 'て', false, '', 'hìrákété')}
    </html>`;
    expect(extractTeFormAccentPosition(html, 'あける')).toEqual({ kind: 'not-found' });
  });

  it('returns not-found when the citation itself is ambiguous, rather than anchoring on an uncertain value', () => {
    const html = `<html>${pronunciationEntry('たかい', 1, 'tàkáꜜì', 'Nakadaka', 2)}
      ${pronunciationEntry('たかい', 0, 'táꜜkàì', 'Atamadaka', 1)}
      ${conjunctiveRow('高くて', '', 'たか', true, 'くて', 'táꜜkàkùtè')}
    </html>`;
    expect(extractTeFormAccentPosition(html, 'たかい')).toEqual({ kind: 'not-found' });
  });

  it('returns not-found when no Conjunctive row exists at all', () => {
    const html = `<html>${pronunciationEntry('かう', 1, 'kàú', 'Heiban', 0)}</html>`;
    expect(extractTeFormAccentPosition(html, 'かう')).toEqual({ kind: 'not-found' });
  });

  it('returns no-page for a redirect', () => {
    const html = `<html><script>RLCONF={"wgIsRedirect":true};</script>${pronunciationEntry('かう', 1, 'kàú', 'Heiban', 0)}</html>`;
    expect(extractTeFormAccentPosition(html, 'かう')).toEqual({ kind: 'no-page' });
  });
});
