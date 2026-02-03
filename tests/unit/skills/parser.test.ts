import { describe, it, expect } from 'vitest';

import { SkillParser } from '../../../src/core/skills/parser.js';

describe('SkillParser (Unit)', () => {
  it('should correctly parse standard SKILL.md with frontmatter', () => {
    const content = `---
name: test-skill
description: A test skill
---
!sh echo hello
Assemble the prompt here.`;
    const skill = SkillParser.parse(content, 'test/path.md');

    expect(skill.metadata.name).toBe('test-skill');
    expect(skill.instructions).toContain('!sh echo hello');
    expect(skill.instructions).toContain('Assemble the prompt here.');
  });

  it('should substitute variables with $ and {} syntax', () => {
    const template = 'Hello $NAME and ${ROLE}';
    const args = { NAME: 'Alice', ROLE: 'Dev' };
    const result = SkillParser.substituteVariables(template, args);
    expect(result).toBe('Hello Alice and Dev');
  });

  it('should extract commands and strip ! or !sh prefix', () => {
    const instructions = 'Line 1\n!sh git status\nLine 3\n!ls -la';
    const commands = SkillParser.extractCommands(instructions);
    // Corrected expectation: should strip !sh and !
    expect(commands).toEqual(['git status', 'ls -la']);
  });

  it('should handle complex command extractions', () => {
    const instructions = '!sh echo "hello world"\n!pwd';
    const commands = SkillParser.extractCommands(instructions);
    expect(commands).toEqual(['echo "hello world"', 'pwd']);
  });
});
