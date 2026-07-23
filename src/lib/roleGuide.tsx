/**
 * Short Cure Dolly–style glosses for Analyze role presets.
 * Kept next to {@link ROLE_PRESET_GROUPS} vocabulary in spirit; imported by
 * Analyze and Help so wording stays consistent.
 */

export type RoleGuideEntry = {
  role: string;
  blurb: string;
};

export type RoleGuideGroup = {
  label: string;
  entries: RoleGuideEntry[];
};

export const ROLE_GUIDE_GROUPS: readonly RoleGuideGroup[] = [
  {
    label: 'Core cars',
    entries: [
      {
        role: 'Aが',
        blurb: 'Visible が-marked subject — who/what the engine is about.',
      },
      {
        role: 'zero-が (∅ subject)',
        blurb: 'Understood が subject that is not said out loud in the Japanese.',
      },
      {
        role: 'を-car',
        blurb: 'を object — the thing directly acted on by the engine.',
      },
      {
        role: 'に-car',
        blurb: 'に target — recipient, destination, time-point, or purpose.',
      },
      {
        role: 'で-car',
        blurb: 'で means or place of the action (by/with/at).',
      },
      {
        role: 'へ-car',
        blurb: 'へ direction toward (heading to…).',
      },
      {
        role: 'と-car',
        blurb: 'と companion or mutual “with”; sometimes a quote partner.',
      },
      {
        role: 'から-car',
        blurb: 'から source — from / since / because-of (as a car).',
      },
      {
        role: 'まで-car',
        blurb: 'まで endpoint — until / as far as.',
      },
      {
        role: 'より-car',
        blurb: 'より comparison base — than / rather than.',
      },
      {
        role: 'の-car',
        blurb: 'の linker — possession, description, or “of” between nouns.',
      },
    ],
  },
  {
    label: 'Topic & focus',
    entries: [
      {
        role: 'topic は',
        blurb: 'は topic — what we are talking about (aboutness), not always the subject.',
      },
      {
        role: 'も-car',
        blurb: 'も — also / even (inclusive focus).',
      },
      {
        role: 'や-car',
        blurb: 'や — non-exhaustive “and …” among examples.',
      },
      {
        role: 'で-car + topic は',
        blurb: 'で-car wrapped as the topic with は.',
      },
      {
        role: 'に-car + topic は',
        blurb: 'に-car wrapped as the topic with は.',
      },
      {
        role: 'へ-car + topic は',
        blurb: 'へ-car wrapped as the topic with は.',
      },
      {
        role: 'と-car + topic は',
        blurb: 'と-car wrapped as the topic with は.',
      },
    ],
  },
  {
    label: 'Engines',
    entries: [
      {
        role: 'engine',
        blurb: 'The predicate that “runs” the sentence (verb, adjective, or copula).',
      },
      {
        role: 'engine: verb',
        blurb: 'Verbal engine (does / happens).',
      },
      {
        role: 'engine: い-adjective',
        blurb: 'い-adjective engine (is [quality]).',
      },
      {
        role: 'engine: だ/です (copula)',
        blurb: 'Copula engine — A is B (だ / です / でした…).',
      },
    ],
  },
  {
    label: 'Connectors & clauses',
    entries: [
      {
        role: 'て-car',
        blurb: 'て-form link on a verb/adj — and / then / manner (not the word そして).',
      },
      {
        role: 'ので (because)',
        blurb: 'ので — because / since (softer cause).',
      },
      {
        role: 'のに (although)',
        blurb: 'のに — although / even though.',
      },
      {
        role: 'clause connector',
        blurb:
          'Discourse glue between clauses/sentences (そして, しかし, それで…).',
      },
      {
        role: 'relative clause',
        blurb: 'Clause that modifies a following noun (the … that …).',
      },
      {
        role: 'quotation と',
        blurb: 'と that marks quoted speech or thought.',
      },
      {
        role: 'nominalizer + topic は',
        blurb: 'の/こと turns a clause into a noun, then は makes it the topic.',
      },
      {
        role: 'nominalizer + Aが',
        blurb: 'の/こと nominalizer with が (subject of a larger structure).',
      },
      {
        role: 'nominalizer + を-car',
        blurb: 'の/こと nominalizer as the を object.',
      },
    ],
  },
  {
    label: 'More particles',
    entries: [
      { role: 'だけ-car', blurb: 'だけ — only / just.' },
      {
        role: 'しか-car',
        blurb: 'しか — only (usually with a negative engine).',
      },
      { role: 'ほど-car', blurb: 'ほど — extent / degree (“as … as”).' },
      { role: 'など-car', blurb: 'など — and so on / things like.' },
      { role: 'とか-car', blurb: 'とか — things like / or (casual list).' },
      { role: 'でも-car', blurb: 'でも — even / or something.' },
      { role: 'ても-car', blurb: 'ても — even if / even though.' },
      {
        role: 'ては-car',
        blurb: 'ては — conditional-ish “if/when”; also “must not” patterns.',
      },
      { role: 'のも-car', blurb: 'のも — also the fact that…' },
      {
        role: 'って-car',
        blurb:
          'って quote or casual topic (「…」って / 日本語って). Not verb て-forms like 思い切って — those are て-car.',
      },
      { role: 'たら-car', blurb: 'たら — when / if (after…).' },
      {
        role: 'たり-car', blurb: 'たり — representative “do things like … and …”.',
      },
      { role: 'なら-car', blurb: 'なら — if it is the case that…' },
    ],
  },
  {
    label: 'Other',
    entries: [
      {
        role: 'time',
        blurb: 'Time expression (ある日, ２週間後, 三時に…).',
      },
      { role: 'adverb', blurb: 'Adverb modifying the engine or clause.' },
      {
        role: 'modifier/content',
        blurb: 'Other content or noun-modifier when no clearer car fits.',
      },
      {
        role: 'sentence ending',
        blurb: 'Ending particles (ね, よ, な, か…) after the engine.',
      },
    ],
  },
] as const;

export function RoleGuideContent({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <div className="stack" style={{ gap: compact ? '0.75rem' : '1rem' }}>
      {ROLE_GUIDE_GROUPS.map((group) => (
        <div key={group.label} className="stack" style={{ gap: '0.35rem' }}>
          <strong style={{ fontSize: compact ? '0.9rem' : undefined }}>
            {group.label}
          </strong>
          <dl
            style={{
              margin: 0,
              display: 'grid',
              gap: '0.35rem 0.75rem',
              gridTemplateColumns: compact ? '1fr' : 'minmax(9rem, 12rem) 1fr',
            }}
          >
            {group.entries.map((entry) => (
              <div
                key={entry.role}
                style={{
                  display: 'contents',
                }}
              >
                <dt
                  className="jp"
                  style={{
                    margin: 0,
                    fontWeight: 600,
                    fontSize: compact ? '0.9rem' : undefined,
                  }}
                >
                  {entry.role}
                </dt>
                <dd
                  className="muted"
                  style={{
                    margin: 0,
                    fontSize: compact ? '0.85rem' : '0.9rem',
                  }}
                >
                  {entry.blurb}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
