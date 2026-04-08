/**
 * Unit tests for lenient parser edge cases.
 *
 * Tests three categories:
 * 1. Fatal rejections — conditions that MUST reject even in lenient mode
 * 2. Lenient warnings — non-fatal violations that load with warnings
 * 3. YAML fallback — recovery from common YAML authoring issues
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.5, 2.6
 */
import { describe, it, expect, beforeEach } from 'bun:test';

import {
  createLogger,
  setLogger,
  tryGetLogger,
} from '../../../src/core/observability/logger.js';
import { SkillParser } from '../../../src/core/skills/parser.js';

// ── Helpers ──────────────────────────────────────────────────────────

beforeEach(() => {
  if (!tryGetLogger()) {
    setLogger(createLogger({ silent: true }));
  }
});

/** Build a minimal valid SKILL.md string. */
function buildSkillMd(fields: Record<string, unknown>, body = 'Instructions here.'): string {
  const lines = Object.entries(fields).map(([k, v]) => {
    if (typeof v === 'string') return `${k}: ${v}`;
    return `${k}: ${JSON.stringify(v)}`;
  });
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

/** Build a file path whose parent dir matches the given skill name. */
function pathForName(name: string): string {
  return `skills/${name}/SKILL.md`;
}

// ── Fatal rejections (lenient mode, strict=false) ────────────────────

describe('Lenient parser — fatal rejections', () => {
  /**
   * Validates: Requirements 1.3, 1.5, 1.7
   *
   * These conditions MUST cause the skill to be skipped even in lenient mode.
   */

  it('rejects missing name field', () => {
    const content = buildSkillMd({ description: 'A skill without a name' });
    expect(() => SkillParser.parse(content, 'skills/x/SKILL.md', false)).toThrow();
  });

  it('rejects empty name field', () => {
    const content = `---\nname: ""\ndescription: A skill with empty name\n---\nBody`;
    expect(() => SkillParser.parse(content, 'skills/x/SKILL.md', false)).toThrow();
  });

  it('rejects non-string name (number)', () => {
    const content = `---\nname: 42\ndescription: A skill with numeric name\n---\nBody`;
    // YAML parses bare 42 as a number, not a string — Zod string() rejects it
    expect(() => SkillParser.parse(content, 'skills/x/SKILL.md', false)).toThrow();
  });

  it('rejects non-string name (boolean)', () => {
    const content = `---\nname: true\ndescription: A skill with boolean name\n---\nBody`;
    expect(() => SkillParser.parse(content, 'skills/x/SKILL.md', false)).toThrow();
  });

  it('rejects missing description field', () => {
    const content = buildSkillMd({ name: 'my-skill' });
    expect(() => SkillParser.parse(content, pathForName('my-skill'), false)).toThrow();
  });

  it('rejects empty description field', () => {
    const content = `---\nname: my-skill\ndescription: ""\n---\nBody`;
    expect(() => SkillParser.parse(content, pathForName('my-skill'), false)).toThrow();
  });

  it('rejects completely unparseable YAML', () => {
    const content = `---\n: [[[invalid yaml {{{{\n---\nBody`;
    expect(() => SkillParser.parse(content, 'skills/x/SKILL.md', false)).toThrow();
  });

  it('rejects missing name via parseFrontmatterOnly', () => {
    const content = buildSkillMd({ description: 'No name here' });
    expect(() =>
      SkillParser.parseFrontmatterOnly(content, 'skills/x/SKILL.md', 'repo', false),
    ).toThrow();
  });

  it('rejects empty description via parseFrontmatterOnly', () => {
    const content = `---\nname: my-skill\ndescription: ""\n---\nBody`;
    expect(() =>
      SkillParser.parseFrontmatterOnly(content, pathForName('my-skill'), 'repo', false),
    ).toThrow();
  });
});


// ── Lenient warnings (non-fatal violations load successfully) ────────

describe('Lenient parser — non-fatal warnings', () => {
  /**
   * Validates: Requirements 1.1, 1.2, 1.6
   *
   * Non-fatal violations produce warnings but still load the skill.
   */

  it('loads skill with name exceeding 64 characters', () => {
    const longName = 'a'.repeat(80);
    const content = buildSkillMd({ name: longName, description: 'Valid description' });
    const filePath = pathForName(longName);

    const skill = SkillParser.parse(content, filePath, false);

    expect(skill.id).toBe(longName);
    expect(skill.metadata.name).toBe(longName);
    expect(skill.metadata.description).toBe('Valid description');
  });

  it('loads skill with regex-violating name (uppercase)', () => {
    const content = `---\nname: "MyUpperCaseSkill"\ndescription: Valid description\n---\nBody`;
    const filePath = pathForName('MyUpperCaseSkill');

    const skill = SkillParser.parse(content, filePath, false);

    expect(skill.id).toBe('MyUpperCaseSkill');
    expect(skill.metadata.name).toBe('MyUpperCaseSkill');
  });

  it('loads skill with regex-violating name (consecutive hyphens)', () => {
    const content = `---\nname: "bad--name"\ndescription: Valid description\n---\nBody`;
    const filePath = pathForName('bad--name');

    const skill = SkillParser.parse(content, filePath, false);

    expect(skill.id).toBe('bad--name');
  });

  it('loads skill with regex-violating name (leading hyphen)', () => {
    const content = `---\nname: "-leading"\ndescription: Valid description\n---\nBody`;
    const filePath = pathForName('-leading');

    const skill = SkillParser.parse(content, filePath, false);

    expect(skill.id).toBe('-leading');
  });

  it('loads skill with description exceeding 1024 characters', () => {
    const longDesc = 'a'.repeat(1100);
    const content = `---\nname: my-skill\ndescription: "${longDesc}"\n---\nBody`;
    const filePath = pathForName('my-skill');

    const skill = SkillParser.parse(content, filePath, false);

    expect(skill.id).toBe('my-skill');
    expect(skill.metadata.description).toBe(longDesc);
    expect(skill.metadata.description.length).toBe(1100);
  });

  it('loads skill with name >64 chars via parseFrontmatterOnly', () => {
    const longName = 'b'.repeat(80);
    const content = buildSkillMd({ name: longName, description: 'Valid description' });
    const filePath = pathForName(longName);

    const entry = SkillParser.parseFrontmatterOnly(content, filePath, 'repo', false);

    expect(entry.id).toBe(longName);
    expect(entry.name).toBe(longName);
    expect(entry.description).toBe('Valid description');
  });

  it('loads skill with regex-violating name via parseFrontmatterOnly', () => {
    const content = `---\nname: "Bad_Name"\ndescription: Valid description\n---\nBody`;
    const filePath = pathForName('Bad_Name');

    const entry = SkillParser.parseFrontmatterOnly(content, filePath, 'repo', false);

    expect(entry.id).toBe('Bad_Name');
    expect(entry.name).toBe('Bad_Name');
  });

  it('loads skill with description >1024 chars via parseFrontmatterOnly', () => {
    const longDesc = 'c'.repeat(1100);
    const content = `---\nname: my-skill\ndescription: "${longDesc}"\n---\nBody`;
    const filePath = pathForName('my-skill');

    const entry = SkillParser.parseFrontmatterOnly(content, filePath, 'repo', false);

    expect(entry.id).toBe('my-skill');
    expect(entry.description).toBe(longDesc);
  });
});


// ── YAML fallback recovery ───────────────────────────────────────────

describe('Lenient parser — YAML fallback', () => {
  /**
   * Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6
   *
   * Tests the YAML fallback recovery mechanism for common authoring issues.
   */

  it('recovers from unquoted colon in description value', () => {
    // This is the canonical example from the spec: `description: Use when: user asks`
    // The `: ` inside the value causes YAML to misparse it.
    const content = `---\nname: pdf-helper\ndescription: Use when: user asks about PDFs\n---\nFollow these instructions.`;
    const filePath = pathForName('pdf-helper');

    const skill = SkillParser.parse(content, filePath, false);

    expect(skill.id).toBe('pdf-helper');
    expect(skill.metadata.name).toBe('pdf-helper');
    // The description should contain the full value including the colon
    expect(skill.metadata.description).toContain('Use when');
    expect(skill.metadata.description).toContain('user asks about PDFs');
  });

  it('preserves body/instructions after YAML fallback recovery', () => {
    const body = 'These are the skill instructions.\n\nDo step 1.\nDo step 2.';
    const content = `---\nname: my-skill\ndescription: Use when: the user needs help\n---\n${body}`;
    const filePath = pathForName('my-skill');

    const skill = SkillParser.parse(content, filePath, false);

    expect(skill.instructions).toBe(body.trim());
  });

  it('body is not affected by YAML fallback (instructions remain intact)', () => {
    // Body contains colons — these should NOT be modified by the fallback
    const body = 'Step 1: do this\nStep 2: do that\nNote: important';
    const content = `---\nname: my-skill\ndescription: Trigger when: user asks\n---\n${body}`;
    const filePath = pathForName('my-skill');

    const skill = SkillParser.parse(content, filePath, false);

    expect(skill.instructions).toBe(body.trim());
  });

  it('garbled YAML fails with original error even after fallback attempt', () => {
    // Completely garbled YAML that even the fallback cannot fix
    const content = `---\n: [[[{{{invalid\n  - :\n    :\n---\nBody`;

    expect(() => SkillParser.parse(content, 'skills/x/SKILL.md', false)).toThrow();
  });

  it('YAML fallback works via parseFrontmatterOnly as well', () => {
    const content = `---\nname: helper\ndescription: Use when: user asks for help\n---\nBody`;
    const filePath = pathForName('helper');

    const entry = SkillParser.parseFrontmatterOnly(content, filePath, 'repo', false);

    expect(entry.id).toBe('helper');
    expect(entry.name).toBe('helper');
    expect(entry.description).toContain('Use when');
    expect(entry.description).toContain('user asks for help');
  });

  it('valid YAML does not trigger fallback and parses normally', () => {
    // Valid YAML with properly quoted colon — should parse on first attempt
    const content = `---\nname: valid-skill\ndescription: "Use when: user asks"\n---\nInstructions`;
    const filePath = pathForName('valid-skill');

    const skill = SkillParser.parse(content, filePath, false);

    expect(skill.id).toBe('valid-skill');
    expect(skill.metadata.description).toBe('Use when: user asks');
    expect(skill.instructions).toBe('Instructions');
  });
});
