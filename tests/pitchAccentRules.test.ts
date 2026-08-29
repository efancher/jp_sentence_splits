import { describe, expect, it } from 'vitest';

import { explainPitchAccent } from '../src/lib/pitchAccentRules';

describe('explainPitchAccent — pattern gloss', () => {
  it('describes each pattern from position + mora count', () => {
    expect(explainPitchAccent({ expression: '同じ', reading: 'おなじ', position: 0, moraCount: 3 }).patternGloss).toContain(
      'Heiban',
    );
    expect(explainPitchAccent({ expression: '雨', reading: 'あめ', position: 1, moraCount: 2 }).patternGloss).toContain(
      'Atamadaka',
    );
    expect(
      explainPitchAccent({ expression: 'お菓子', reading: 'おかし', position: 2, moraCount: 3 }).patternGloss,
    ).toContain('Nakadaka');
    expect(explainPitchAccent({ expression: '男', reading: 'おとこ', position: 3, moraCount: 3 }).patternGloss).toContain(
      'Odaka',
    );
  });

  it('uses one-mora phrasing for single-mora words', () => {
    expect(explainPitchAccent({ expression: '手', reading: 'て', position: 0, moraCount: 1 }).patternGloss).toContain(
      'one-mora word stays high',
    );
  });
});

describe('explainPitchAccent — rule notes', () => {
  it('flags pre-accenting suffixes when the dictionary agrees', () => {
    const note = explainPitchAccent({
      expression: '経済的',
      reading: 'けいざいてき',
      partOfSpeech: 'adj-na',
      position: 4,
      moraCount: 6,
    }).ruleNote;
    expect(note).toContain('〜的');
  });

  it('stays silent on a 〜的-family word whose accent is not pre-accenting', () => {
    expect(
      explainPitchAccent({
        expression: '目的',
        reading: 'もくてき',
        partOfSpeech: 'n',
        position: 0,
        moraCount: 4,
      }).ruleNote,
    ).toBeUndefined();
  });

  it('notes the antepenultimate tendency for a regular loanword', () => {
    const note = explainPitchAccent({
      expression: 'テレビ',
      reading: 'テレビ',
      position: 1,
      moraCount: 3,
    }).ruleNote;
    expect(note).toContain('third-from-last mora');
  });

  it('handles the special-mora leftward shift (コーヒー)', () => {
    const note = explainPitchAccent({
      expression: 'コーヒー',
      reading: 'コーヒー',
      position: 1,
      moraCount: 4,
    }).ruleNote;
    expect(note).toContain('third-from-last mora');
  });

  it('notes heiban drift for an unaccented loanword', () => {
    const note = explainPitchAccent({
      expression: 'テーブル',
      reading: 'テーブル',
      position: 0,
      moraCount: 4,
    }).ruleNote;
    expect(note).toContain('heiban');
  });

  it('explains the unaccented verb class', () => {
    const note = explainPitchAccent({
      expression: '食べる',
      reading: 'たべる',
      partOfSpeech: 'v1,vt',
      position: 0,
      moraCount: 3,
    }).ruleNote;
    expect(note).toContain('two accent classes');
    expect(note).toContain('flat');
  });

  it('explains the accented verb class (penultimate downstep)', () => {
    const note = explainPitchAccent({
      expression: '見る',
      reading: 'みる',
      partOfSpeech: 'v1,vt',
      position: 1,
      moraCount: 2,
    }).ruleNote;
    expect(note).toContain('second-to-last mora');
  });

  it('explains accented i-adjectives', () => {
    const note = explainPitchAccent({
      expression: '赤い',
      reading: 'あかい',
      partOfSpeech: 'adj-i',
      position: 2,
      moraCount: 3,
    }).ruleNote;
    expect(note).toContain('second-to-last mora');
  });

  it('falls back to "memorized" for a plain native noun', () => {
    const note = explainPitchAccent({
      expression: '箸',
      reading: 'はし',
      partOfSpeech: 'n',
      position: 1,
      moraCount: 2,
    }).ruleNote;
    expect(note).toContain('memorized');
  });

  it('has no rule note for a native noun that is not tagged', () => {
    expect(
      explainPitchAccent({ expression: '橋', reading: 'はし', position: 2, moraCount: 2 }).ruleNote,
    ).toBeUndefined();
  });
});
