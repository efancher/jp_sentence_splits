import { Fragment, type ReactNode } from 'react';

/**
 * Renders a WaniKani mnemonic string. WaniKani wraps salient words in its own
 * inline markup — `<radical>`, `<kanji>`, `<vocabulary>`, `<reading>`,
 * `<meaning>`, `<ja>` — which we turn into colour-coded spans (no HTML is
 * ever injected; the tags are parsed, not rendered). Unknown tags fall back
 * to their plain inner text. Text is `pre-wrap` since WaniKani's mnemonics
 * carry real paragraph breaks.
 *
 * Only used as optional scaffolding on review cards (`ReviewPage`'s "Show
 * mnemonic"); the source data is `VocabularyItem.meaningMnemonic` /
 * `readingMnemonic`, backfilled by `scripts/backfill-wanikani-mnemonics.ts`.
 */
const TAG_CLASS: Record<string, string> = {
  radical: 'mnemonic-tag mnemonic-radical',
  kanji: 'mnemonic-tag mnemonic-kanji',
  vocabulary: 'mnemonic-tag mnemonic-vocabulary',
  reading: 'mnemonic-tag mnemonic-reading',
  meaning: 'mnemonic-tag mnemonic-meaning',
  ja: 'mnemonic-tag mnemonic-ja',
};

// WaniKani doesn't nest these tags, so a non-greedy single-level match is enough.
const TOKEN_RE = /<(radical|kanji|vocabulary|reading|meaning|ja)>([\s\S]*?)<\/\1>/g;

function parseMnemonic(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  let key = 0;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<Fragment key={key++}>{text.slice(lastIndex, match.index)}</Fragment>);
    }
    const [, tag, inner] = match;
    nodes.push(
      <span key={key++} className={TAG_CLASS[tag]}>
        {inner}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(<Fragment key={key++}>{text.slice(lastIndex)}</Fragment>);
  }
  return nodes;
}

export function MnemonicText({ text }: { text: string }) {
  return <span className="mnemonic-text">{parseMnemonic(text)}</span>;
}
