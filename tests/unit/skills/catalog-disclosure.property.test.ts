import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';

import { SkillLoader } from '../../../src/core/skills/loader.js';
import type { SkillCatalogEntry } from '../../../src/core/skills/types.js';

function makeEntry(name: string, description: string): SkillCatalogEntry {
  return {
    id: name,
    name,
    description,
    location: `/skills/${name}/SKILL.md`,
    scope: 'repo',
  };
}

describe('catalog disclosure properties (strict mode)', () => {
  it('contains every entry name from input catalog', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
            description: fc.string({ minLength: 1, maxLength: 60 }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (items) => {
          const dedup = new Map<string, SkillCatalogEntry>();
          for (const item of items) {
            dedup.set(item.name, makeEntry(item.name, item.description));
          }

          const catalog = [...dedup.values()];
          const output = SkillLoader.formatCatalogDisclosure(catalog);

          for (const entry of catalog) {
            expect(output).toContain(`**${entry.name}**`);
          }
        },
      ),
    );
  });
});
