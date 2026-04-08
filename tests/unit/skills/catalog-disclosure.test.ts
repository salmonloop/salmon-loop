import { describe, expect, it } from 'bun:test';

import { SkillLoader } from '../../../src/core/skills/loader.js';
import type { SkillCatalogEntry } from '../../../src/core/skills/types.js';

function makeEntry(name: string): SkillCatalogEntry {
  return {
    id: name,
    name,
    description: `${name} description`,
    location: `/skills/${name}/SKILL.md`,
    scope: 'repo',
  };
}

describe('SkillLoader.formatCatalogDisclosure', () => {
  it('returns empty string for empty catalog', () => {
    expect(SkillLoader.formatCatalogDisclosure([])).toBe('');
  });

  it('renders all catalog entries in strict mode', () => {
    const output = SkillLoader.formatCatalogDisclosure([makeEntry('alpha'), makeEntry('beta')]);

    expect(output).toContain('## Available Skills');
    expect(output).toContain('**alpha**');
    expect(output).toContain('**beta**');
  });
});
