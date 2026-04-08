import { describe, expect, it } from 'bun:test';

import { SkillParser } from '../../../../src/core/skills/parser.js';

describe('SkillParser.parseFrontmatterOnly()', () => {
  it('extracts lightweight catalog fields from valid frontmatter', () => {
    const content = '---\nname: my-skill\ndescription: "A useful skill"\n---\nLong instructions body here.\n';
    const entry = SkillParser.parseFrontmatterOnly(content, '/skills/my-skill/SKILL.md', 'repo');

    expect(entry).toEqual({
      id: 'my-skill',
      name: 'my-skill',
      description: 'A useful skill',
      location: '/skills/my-skill/SKILL.md',
      scope: 'repo',
    });
  });

  it('throws on missing frontmatter', () => {
    expect(() => SkillParser.parseFrontmatterOnly('No frontmatter', '/skills/x/SKILL.md', 'repo')).toThrow(
      /missing or malformed YAML frontmatter/,
    );
  });

  it('throws on name-directory mismatch', () => {
    const content = '---\nname: wrong-name\ndescription: "Mismatch"\n---\nBody.\n';
    expect(() => SkillParser.parseFrontmatterOnly(content, '/skills/correct-name/SKILL.md', 'repo')).toThrow(
      /does not match parent directory/,
    );
  });
});
