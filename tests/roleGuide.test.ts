import { describe, expect, it } from 'vitest';

import { roleGuideBlurb, ROLE_GUIDE_GROUPS } from '../src/lib/roleGuide';
import { ROLE_PRESET_GROUPS } from '../src/appConfig';

describe('roleGuideBlurb', () => {
  it('returns the blurb for a known role', () => {
    expect(roleGuideBlurb('topic は')).toMatch(/topic/i);
    expect(roleGuideBlurb('engine')).toBeDefined();
  });

  it('returns undefined for a custom/unknown role', () => {
    expect(roleGuideBlurb('counter expression')).toBeUndefined();
    expect(roleGuideBlurb('')).toBeUndefined();
  });

  it('has a guide entry for every role in the AnalyzePage role dropdown', () => {
    const presetRoles = ROLE_PRESET_GROUPS.flatMap((group) => group.roles);
    for (const role of presetRoles) {
      expect(roleGuideBlurb(role), `missing role-guide entry for "${role}"`).toBeDefined();
    }
  });

  it('does not carry any guide entries the dropdown no longer offers', () => {
    const presetRoleSet = new Set(ROLE_PRESET_GROUPS.flatMap((group) => group.roles));
    const guideRoles = ROLE_GUIDE_GROUPS.flatMap((group) =>
      group.entries.map((entry) => entry.role),
    );
    for (const role of guideRoles) {
      expect(presetRoleSet.has(role), `stale role-guide entry for "${role}"`).toBe(true);
    }
  });
});
