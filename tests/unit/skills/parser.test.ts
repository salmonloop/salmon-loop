import { describe, expect, it } from 'bun:test';

import { SkillParser } from '../../../src/core/skills/parser.js';

describe('SkillParser.parse', () => {
  it('parses strict AgentSkills frontmatter', () => {
    const content = [
      '---',
      'name: strict-skill',
      'description: "Strict parser"',
      'allowed-tools: shell.exec',
      '---',
      '!echo hi',
    ].join('\n');

    const skill = SkillParser.parse(content, '/tmp/strict-skill/SKILL.md');

    expect(skill.id).toBe('strict-skill');
    expect(skill.metadata['allowed-tools']).toBe('shell.exec');
    expect(skill.instructions).toContain('!echo hi');
  });

  it('rejects unknown extension fields', () => {
    const content = [
      '---',
      'name: strict-skill',
      'description: "Strict parser"',
      'userInvocable: false',
      '---',
      'Body',
    ].join('\n');

    expect(() => SkillParser.parse(content, '/tmp/strict-skill/SKILL.md')).toThrow(
      /frontmatter validation failed/,
    );
  });

  it('rejects name-directory mismatch', () => {
    const content = ['---', 'name: wrong', 'description: "desc"', '---', 'Body'].join('\n');
    expect(() => SkillParser.parse(content, '/tmp/right/SKILL.md')).toThrow(
      /does not match parent directory/,
    );
  });
});
