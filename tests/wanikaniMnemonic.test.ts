import { describe, expect, it } from 'vitest';

import { isDeferralMnemonic, stripMnemonicMarkup } from '../src/lib/wanikaniMnemonic';

describe('stripMnemonicMarkup', () => {
  it('removes WaniKani inline tags, keeps the text', () => {
    expect(
      stripMnemonicMarkup('The <radical>gun</radical> makes a <reading>せい</reading> sound.'),
    ).toBe('The gun makes a せい sound.');
  });
});

describe('isDeferralMnemonic', () => {
  it('flags WaniKani "you already know the kanji" placeholders', () => {
    for (const text of [
      "This is a jukugo word that uses the on'yomi readings of the kanji. Because of that, you should be able to read this word on your own.",
      'You already know how to read this word, since it uses the readings you learned for the kanji.',
      "Since this is a single kanji vocab word, the reading is the same as the kanji's reading.",
      'The kanji and the word are exactly the same. That means they share meanings as well!',
      'The kanji and the word are exactly the same. That means they share readings as well!',
      'This word uses the same reading as the one you learned with the kanji. ' +
        '<vocabulary>I</vocabulary> certainly like that and I bet you do too.',
      'No mnemonic is needed here.',
      'You know this already!',
    ]) {
      expect(isDeferralMnemonic(text), text).toBe(true);
    }
  });

  it('does not flag a real, paragraph-length mnemonic', () => {
    const real =
      'Your <vocabulary>mother</vocabulary> (<ja>かあ</ja>) is standing next to a pile of ' +
      '<reading>かね</reading> (money). She waves a fistful of cash and shouts that with this ' +
      'money she will raise you right. Picture the scene vividly and the reading sticks.';
    expect(isDeferralMnemonic(real)).toBe(false);
  });

  it('treats an empty or one-liner mnemonic as a deferral', () => {
    expect(isDeferralMnemonic('')).toBe(true);
    expect(isDeferralMnemonic('The reading is しゃ.')).toBe(true);
  });
});
