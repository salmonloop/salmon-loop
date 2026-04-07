/**
 * Unit tests for SkillParser.parseFrontmatterOnly() — Tier 1 catalog parsing.
 *
 * Validates: Requirements 6.1, 6.3
 */
import { describe, expect, it } from 'bun:test';

import { SkillParser } from '../../../../src/core/skills/parser.js';

describe('SkillParser.parseFrontmatterOnly()', () => {
  it('extracts name, description, location, and scope from valid frontmatter', () => {
    const content = '---\nname: my-skill\ndescription: "A useful skill"\n---\nLong instructions body here.\n';
    const entry = SkillParser.parseFrontmatterOnly(content, '/skills/my-skill/SKILL.md', 'repo');

    expect(entry.id).toBe('my-skill');
    expect(entry.name).toBe('my-skill');
    expect(entry.description).toBe('A useful skill');
    expect(entry.location).toBe('/skills/my-skill/SKILL.md');
    expect(entry.scope).toBe('repo');
  });

  it('includes conditionalPaths when paths field is present', () => {
    const content = '---\nname: cond-skill\ndescription: "Conditional"\npaths:\n  - "src/**"\n  - "lib/**"\n---\nBody.\n';
    const entry = SkillParser.parseFrontmatterOnly(content, '/skills/cond-skill/SKILL.md', 'user');

    expect(entry.conditionalPaths).toEqual(['src/**', 'lib/**']);
    expect(entry.scope).toBe('user');
  });

  it('omits conditionalPaths when paths field is absent', () => {
    const content = '---\nname: simple\ndescription: "Simple skill"\n---\nBody.\n';
    const entry = SkillParser.parseFrontmatterOnly(content, '/skills/simple/SKILL.md', 'config');

    expect(entry.conditionalPaths).toBeUndefined();
    expect(entry.scope).toBe('config');
  });

  it('does not include instructions or rawContent in the result', () => {
    const content = '---\nname: lean\ndescription: "Lean entry"\n---\nVery long instructions that should not be in catalog.\n';
    const entry = SkillParser.parseFrontmatterOnly(content, '/skills/lean/SKILL.md', 'repo');

    const asRecord = entry as unknown as Record<string, unknown>;
    expect(asRecord['instructions']).toBeUndefined();
    expect(asRecord['rawContent']).toBeUndefined();
  });

  it('throws on missing frontmatter', () => {
    const content = 'No frontmatter here.';
    expect(() =>
      SkillParser.parseFrontmatterOnly(content, '/skills/bad/SKILL.md', 'repo'),
    ).toThrow(/missing or malformed YAML frontmatter/);
  });

  it('throws on invalid frontmatter (missing description)', () => {
    const content = '---\nname: no-desc\n---\nBody.\n';
    expect(() =>
      SkillParser.parseFrontmatterOnly(content, '/skills/no-desc/SKILL.md', 'repo'),
    ).toThrow(/frontmatter validation failed/);
  });

  it('throws on name-directory mismatch in strict mode', () => {
    const content = '---\nname: wrong-name\ndescription: "Mismatch"\n---\nBody.\n';
    expect(() =>
      SkillParser.parseFrontmatterOnly(content, '/skills/correct-name/SKILL.md', 'repo', true),
    ).toThrow(/does not match parent directory/);
  });

  it('does not throw on name-directory mismatch in non-strict mode', () => {
    const content = '---\nname: wrong-name\ndescription: "Mismatch"\n---\nBody.\n';
    const entry = SkillParser.parseFrontmatterOnly(content, '/skills/correct-name/SKILL.md', 'repo', false);
    expect(entry.name).toBe('wrong-name');
  });
});
