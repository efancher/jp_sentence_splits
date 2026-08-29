import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MnemonicText } from '../src/components/MnemonicText';

describe('MnemonicText', () => {
  it('wraps WaniKani markup tags in colour-coded spans without injecting HTML', () => {
    const { container } = render(
      <MnemonicText text="The <radical>gun</radical> makes the <kanji>correct</kanji> sound <reading>せい</reading>." />,
    );
    expect(container.querySelector('.mnemonic-radical')?.textContent).toBe('gun');
    expect(container.querySelector('.mnemonic-kanji')?.textContent).toBe('correct');
    expect(container.querySelector('.mnemonic-reading')?.textContent).toBe('せい');
    // Plain text between tags is preserved.
    expect(container.textContent).toBe('The gun makes the correct sound せい.');
  });

  it('renders a raw string with no tags unchanged', () => {
    const { container } = render(<MnemonicText text="Just a plain sentence." />);
    expect(container.textContent).toBe('Just a plain sentence.');
    expect(container.querySelector('.mnemonic-tag')).toBeNull();
  });

  it('treats an unknown tag as literal text rather than a span', () => {
    const { container } = render(<MnemonicText text="a <bogus>x</bogus> b" />);
    expect(container.querySelector('.mnemonic-tag')).toBeNull();
    expect(container.textContent).toBe('a <bogus>x</bogus> b');
  });
});
