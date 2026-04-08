import { describe, expect, it } from 'bun:test';

import { SkillDiscoveryWatcher, matchGlob } from '../../../src/core/skills/discovery.js';
import type { SkillCatalogEntry } from '../../../src/core/skills/types.js';

function entry(id: string): SkillCatalogEntry {
  return {
    id,
    name: id,
    description: `${id} skill`,
    location: `/skills/${id}/SKILL.md`,
    scope: 'repo',
  };
}

describe('matchGlob', () => {
  it('matches * and ** patterns', () => {
    expect(matchGlob('src/a/b.ts', 'src/**/*.ts')).toBe(true);
    expect(matchGlob('src/a/b.ts', 'src/*.ts')).toBe(false);
    expect(matchGlob('src/main.ts', 'src/*.ts')).toBe(true);
  });
});

describe('SkillDiscoveryWatcher', () => {
  it('returns new entries on refresh', () => {
    const watcher = new SkillDiscoveryWatcher([entry('a')]);
    const newlyDiscovered = watcher.refreshCatalog([entry('a'), entry('b')]);

    expect(newlyDiscovered.map((i) => i.id)).toEqual(['b']);
  });
});
