/**
 * Unit + Property-based tests for SkillParser.
 *
 * Property 6: Frontmatter Validity — name format, name=dirName match
 * Property 7: Boolean Type Correctness — userInvocable coercion
 * Property 8: Hidden Skill Invisibility — hidden skill not in slash suggestions
 *
 * Unit tests: malformed YAML, missing name, missing description, invalid name format, consecutive hyphens
 * Unit tests: userInvocable: false, "false", missing field
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 10.1
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';

import {
  createLogger,
  setLogger,
  tryGetLogger,
} from '../../../src/core/observability/logger.js';
import { SkillParser, SkillFrontmatterSchema } from '../../../src/core/skills/parser.js';
import type { Skill } from '../../../src/core/skills/types.js';
import { createSlashRegistry } from '../../../src/core/slash/registry.js';
import type { SlashCommandSpec } from '../../../src/core/slash/types.js';

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

/**
 * Replicate the logic from src/cli/slash/runtime.ts skillToSlashSpec
 * to avoid importing the full CLI runtime (which has heavy deps).
 */
function skillToSlashSpec(skill: Skill): SlashCommandSpec | null {
  const id = String(skill.id || '').trim();
  if (!id || !/^[a-z0-9][a-z0-9-_]*$/i.test(id)) return null;
  return {
    name: `/${id}`,
    description: skill.metadata?.description || `Skill: ${id}`,
    hidden: skill.metadata?.userInvocable === false,
    order: 220,
  };
}


// ── fast-check arbitraries ───────────────────────────────────────────

const ALPHA_CHARS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const ALNUM_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');

/**
 * Generates a non-empty lowercase alphanumeric segment starting with a letter.
 * Starting with a letter avoids YAML interpreting pure-digit names as numbers.
 */
const alnumSegmentArb = fc
  .tuple(
    fc.constantFrom(...ALPHA_CHARS),
    fc.array(fc.constantFrom(...ALNUM_CHARS), { minLength: 0, maxLength: 7 }),
  )
  .map(([first, rest]) => first + rest.join(''));

/** Generates valid skill names: lowercase alphanumeric + single hyphens, no leading/trailing hyphens. */
const validNameArb = fc
  .tuple(
    alnumSegmentArb,
    fc.array(alnumSegmentArb, { minLength: 0, maxLength: 3 }),
  )
  .map(([head, segments]) => segments.length === 0 ? head : head + '-' + segments.join('-'))
  .filter((s) => s.length >= 1 && s.length <= 64);

/** Generates safe YAML description strings (no special chars that break YAML). */
const safeDescArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), { minLength: 1, maxLength: 50 })
  .map((chars) => chars.join('').trim())
  .filter((s) => s.length > 0);

/** Generates invalid names that violate the naming rules. */
const invalidNameArb = fc.oneof(
  // Uppercase letters
  fc.constant('MySkill'),
  // Leading hyphen
  fc.constant('-bad'),
  // Trailing hyphen
  fc.constant('bad-'),
  // Consecutive hyphens
  fc.constant('bad--name'),
  // Special characters
  fc.constant('bad_name'),
  fc.constant('bad.name'),
  fc.constant('bad name'),
  // Empty
  fc.constant(''),
);

// ── Existing basic tests ─────────────────────────────────────────────

describe('SkillParser (Unit)', () => {
  it('should correctly parse standard SKILL.md with frontmatter', () => {
    const content = `---
name: test-skill
description: A test skill
---
!sh echo hello
Assemble the prompt here.`;
    const skill = SkillParser.parse(content, 'skills/test-skill/SKILL.md');

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
    expect(commands).toEqual(['git status', 'ls -la']);
  });

  it('should handle complex command extractions', () => {
    const instructions = '!sh echo "hello world"\n!pwd';
    const commands = SkillParser.extractCommands(instructions);
    expect(commands).toEqual(['echo "hello world"', 'pwd']);
  });
});


// ── Unit tests: malformed YAML, missing fields, invalid format ───────

describe('SkillParser — strict frontmatter validation', () => {
  describe('malformed YAML', () => {
    it('rejects content with no frontmatter delimiters', () => {
      expect(() => SkillParser.parse('no frontmatter here', 'skills/x/SKILL.md')).toThrow();
    });

    it('rejects content with only opening delimiter', () => {
      expect(() => SkillParser.parse('---\nname: x\n', 'skills/x/SKILL.md')).toThrow();
    });

    it('rejects invalid YAML syntax inside frontmatter', () => {
      const content = '---\n: [invalid yaml\n---\nBody';
      expect(() => SkillParser.parse(content, 'skills/x/SKILL.md')).toThrow();
    });

    it('rejects empty frontmatter block', () => {
      const content = '---\n\n---\nBody';
      expect(() => SkillParser.parse(content, 'skills/x/SKILL.md')).toThrow();
    });
  });

  describe('missing required fields', () => {
    it('rejects frontmatter with missing name', () => {
      const content = buildSkillMd({ description: 'A skill' });
      expect(() => SkillParser.parse(content, 'skills/x/SKILL.md')).toThrow();
    });

    it('rejects frontmatter with missing description', () => {
      const content = buildSkillMd({ name: 'my-skill' });
      expect(() => SkillParser.parse(content, pathForName('my-skill'))).toThrow();
    });
  });

  describe('Unicode lowercase name support (AgentSkills spec compliance)', () => {
    it('accepts Unicode lowercase letters in name', () => {
      const content = buildSkillMd({ name: 'café', description: 'A French skill' });
      const skill = SkillParser.parse(content, pathForName('café'), false);
      expect(skill.id).toBe('café');
    });

    it('accepts CJK-range lowercase in name', () => {
      // Chinese characters are classified as \p{Ll} = false, \p{Lo} = true.
      // The AgentSkills spec says "unicode lowercase alphanumeric" which maps
      // to \p{Ll} (lowercase letter) + \p{N} (number). CJK ideographs are
      // \p{Lo} (other letter), not \p{Ll}, so they should be rejected.
      const content = buildSkillMd({ name: '技能', description: 'CJK skill' });
      expect(() => SkillParser.parse(content, pathForName('技能'), false)).toThrow();
    });

    it('rejects Unicode uppercase letters in name', () => {
      const content = buildSkillMd({ name: 'Ñoño', description: 'Uppercase Ñ' });
      expect(() => SkillParser.parse(content, pathForName('Ñoño'), false)).toThrow();
    });

    it('accepts name with Unicode digits', () => {
      // Unicode digit: ٣ (Arabic-Indic digit three, \p{N})
      const content = buildSkillMd({ name: 'skill-٣', description: 'Unicode digit' });
      const skill = SkillParser.parse(content, pathForName('skill-٣'), false);
      expect(skill.id).toBe('skill-٣');
    });
  });

  describe('frontmatter-only SKILL.md (no body)', () => {
    it('parse() succeeds for frontmatter-only content without trailing newline', () => {
      const content = '---\nname: minimal\ndescription: No body\n---';
      const skill = SkillParser.parse(content, pathForName('minimal'), false);
      expect(skill.id).toBe('minimal');
      expect(skill.instructions).toBe('');
    });

    it('parse() succeeds for frontmatter with trailing newline but no body', () => {
      const content = '---\nname: minimal\ndescription: No body\n---\n';
      const skill = SkillParser.parse(content, pathForName('minimal'), false);
      expect(skill.id).toBe('minimal');
      expect(skill.instructions).toBe('');
    });

    it('parseFrontmatterOnly() and parse() agree on frontmatter-only content', () => {
      const content = '---\nname: consistent\ndescription: Both should work\n---';
      const catalog = SkillParser.parseFrontmatterOnly(content, pathForName('consistent'), 'repo', false);
      const full = SkillParser.parse(content, pathForName('consistent'), false);
      expect(catalog.id).toBe(full.id);
      expect(catalog.name).toBe(full.metadata.name);
    });
  });

  describe('invalid name format', () => {
    it('rejects name with uppercase letters', () => {
      const content = buildSkillMd({ name: 'MySkill', description: 'desc' });
      expect(() => SkillParser.parse(content, pathForName('MySkill'))).toThrow();
    });

    it('rejects name with leading hyphen', () => {
      const content = buildSkillMd({ name: '-bad', description: 'desc' });
      expect(() => SkillParser.parse(content, pathForName('-bad'))).toThrow();
    });

    it('rejects name with trailing hyphen', () => {
      const content = buildSkillMd({ name: 'bad-', description: 'desc' });
      expect(() => SkillParser.parse(content, pathForName('bad-'))).toThrow();
    });

    it('rejects name with consecutive hyphens', () => {
      const content = buildSkillMd({ name: 'bad--name', description: 'desc' });
      expect(() => SkillParser.parse(content, pathForName('bad--name'))).toThrow();
    });

    it('rejects name with special characters (underscore)', () => {
      const content = buildSkillMd({ name: 'bad_name', description: 'desc' });
      expect(() => SkillParser.parse(content, pathForName('bad_name'))).toThrow();
    });

    it('rejects name exceeding 64 characters', () => {
      const longName = 'a'.repeat(65);
      const content = buildSkillMd({ name: longName, description: 'desc' });
      expect(() => SkillParser.parse(content, pathForName(longName))).toThrow();
    });
  });
});


// ── Unit tests: userInvocable coercion ───────────────────────────────

describe('SkillParser — userInvocable boolean coercion', () => {
  it('coerces string "false" to boolean false', () => {
    const _content = buildSkillMd({ name: 'hidden-skill', description: 'desc', userInvocable: '"false"' });
    // YAML will parse "false" (with quotes in YAML) as the string "false"
    // But our buildSkillMd uses JSON.stringify for non-strings, so let's use raw YAML:
    const raw = `---
name: hidden-skill
description: A hidden skill
userInvocable: "false"
---
Body`;
    const skill = SkillParser.parse(raw, pathForName('hidden-skill'));
    expect(skill.metadata.userInvocable).toBe(false);
    expect(typeof skill.metadata.userInvocable).toBe('boolean');
  });

  it('coerces string "true" to boolean true', () => {
    const raw = `---
name: visible-skill
description: A visible skill
userInvocable: "true"
---
Body`;
    const skill = SkillParser.parse(raw, pathForName('visible-skill'));
    expect(skill.metadata.userInvocable).toBe(true);
    expect(typeof skill.metadata.userInvocable).toBe('boolean');
  });

  it('preserves boolean false as-is', () => {
    const raw = `---
name: hidden-skill
description: A hidden skill
userInvocable: false
---
Body`;
    const skill = SkillParser.parse(raw, pathForName('hidden-skill'));
    expect(skill.metadata.userInvocable).toBe(false);
    expect(typeof skill.metadata.userInvocable).toBe('boolean');
  });

  it('defaults to true when userInvocable is missing', () => {
    const raw = `---
name: default-skill
description: A default skill
---
Body`;
    const skill = SkillParser.parse(raw, pathForName('default-skill'));
    expect(skill.metadata.userInvocable).toBe(true);
    expect(typeof skill.metadata.userInvocable).toBe('boolean');
  });
});


// ── Property 6: Frontmatter Validity ─────────────────────────────────

describe('Property 6: Frontmatter Validity', () => {
  /**
   * **Validates: Requirements 5.2, 5.3**
   *
   * ∀ skill ∈ LoadedSkills:
   *   skill.metadata.name matches /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
   *   ∧ skill.metadata.name == parentDirName(skill.path)
   */
  it('valid names always parse successfully and match parent dir', () => {
    fc.assert(
      fc.property(validNameArb, safeDescArb, (name, desc) => {
        const content = `---\nname: ${name}\ndescription: "${desc}"\n---\nBody`;
        const filePath = pathForName(name);

        const skill = SkillParser.parse(content, filePath);

        // Name matches the regex
        expect(skill.metadata.name).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
        // No consecutive hyphens
        expect(skill.metadata.name).not.toContain('--');
        // Name equals parent directory
        expect(skill.metadata.name).toBe(name);
        expect(skill.id).toBe(name);
      }),
      { numRuns: 50 },
    );
  });

  it('invalid names always cause parse to throw', () => {
    fc.assert(
      fc.property(invalidNameArb, (name) => {
        const content = `---\nname: ${name}\ndescription: A skill\n---\nBody`;
        const filePath = pathForName(name);

        expect(() => SkillParser.parse(content, filePath)).toThrow();
      }),
    );
  });

  it('name-directory mismatch throws in strict mode', () => {
    fc.assert(
      fc.property(validNameArb, validNameArb, (name, dirName) => {
        fc.pre(name !== dirName);
        const content = `---\nname: ${name}\ndescription: A skill\n---\nBody`;
        const filePath = `skills/${dirName}/SKILL.md`;

        expect(() => SkillParser.parse(content, filePath, true)).toThrow();
      }),
      { numRuns: 30 },
    );
  });

  it('name-directory mismatch does NOT throw in compat mode', () => {
    fc.assert(
      fc.property(validNameArb, validNameArb, (name, dirName) => {
        fc.pre(name !== dirName);
        const content = `---\nname: ${name}\ndescription: A skill\n---\nBody`;
        const filePath = `skills/${dirName}/SKILL.md`;

        const skill = SkillParser.parse(content, filePath, false);
        expect(skill.metadata.name).toBe(name);
      }),
      { numRuns: 30 },
    );
  });
});


// ── Property 7: Boolean Type Correctness ─────────────────────────────

describe('Property 7: Boolean Type Correctness', () => {
  /**
   * **Validates: Requirements 5.5**
   *
   * ∀ skill ∈ LoadedSkills: typeof skill.metadata.userInvocable === 'boolean'
   */
  const boolishArb = fc.oneof(
    fc.constant(true),
    fc.constant(false),
    fc.constant('true'),
    fc.constant('false'),
    fc.constant('True'),
    fc.constant('False'),
  );

  it('userInvocable is always a boolean after parsing, regardless of input type', () => {
    fc.assert(
      fc.property(validNameArb, boolishArb, (name, rawValue) => {
        // Build YAML with the raw value — YAML booleans and quoted strings
        let yamlValue: string;
        if (typeof rawValue === 'boolean') {
          yamlValue = String(rawValue);
        } else {
          // Quote the string so YAML treats it as a string, not a boolean
          yamlValue = `"${rawValue}"`;
        }

        const content = `---\nname: ${name}\ndescription: A skill\nuserInvocable: ${yamlValue}\n---\nBody`;
        const filePath = pathForName(name);

        const skill = SkillParser.parse(content, filePath);
        expect(typeof skill.metadata.userInvocable).toBe('boolean');
      }),
      { numRuns: 50 },
    );
  });

  it('Zod schema coerces string booleans correctly', () => {
    fc.assert(
      fc.property(boolishArb, (rawValue) => {
        const input = {
          name: 'test-skill',
          description: 'A test skill',
          userInvocable: rawValue,
        };
        const result = SkillFrontmatterSchema.safeParse(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(typeof result.data.userInvocable).toBe('boolean');
          // Verify correct coercion direction
          const expected = typeof rawValue === 'boolean'
            ? rawValue
            : rawValue.toLowerCase() === 'true';
          expect(result.data.userInvocable).toBe(expected);
        }
      }),
    );
  });
});


// ── Property 8: Hidden Skill Invisibility ────────────────────────────

describe('Property 8: Hidden Skill Invisibility', () => {
  /**
   * **Validates: Requirements 5.6**
   *
   * ∀ skill WHERE skill.metadata.userInvocable === false:
   *   skill ∉ slashSuggestions ∧ skill ∉ invocableListings
   */

  function makeSkill(name: string, userInvocable: boolean): Skill {
    return {
      id: name,
      path: pathForName(name),
      metadata: {
        name,
        description: `Skill: ${name}`,
        userInvocable,
      },
      rawContent: '',
      instructions: '',
    };
  }

  it('skill with userInvocable=false produces a slash spec with hidden=true', () => {
    const skill = makeSkill('hidden-skill', false);
    const spec = skillToSlashSpec(skill);
    expect(spec).not.toBeNull();
    expect(spec!.hidden).toBe(true);
  });

  it('skill with userInvocable=true produces a slash spec with hidden=false', () => {
    const skill = makeSkill('visible-skill', true);
    const spec = skillToSlashSpec(skill);
    expect(spec).not.toBeNull();
    expect(spec!.hidden).toBe(false);
  });

  it('slash registry suggest() excludes hidden commands', () => {
    const hiddenSkill = makeSkill('secret-tool', false);
    const visibleSkill = makeSkill('public-tool', true);

    const hiddenSpec = skillToSlashSpec(hiddenSkill)!;
    const visibleSpec = skillToSlashSpec(visibleSkill)!;

    const registry = createSlashRegistry({
      commands: [hiddenSpec, visibleSpec],
    });

    const suggestions = registry.suggest('/');
    const names = suggestions.map((s) => s.name.trim());

    expect(names).toContain('/public-tool');
    expect(names).not.toContain('/secret-tool');
  });

  it('hidden skills are in list() but filtered from suggest()', () => {
    const hiddenSkill = makeSkill('internal-cmd', false);
    const spec = skillToSlashSpec(hiddenSkill)!;

    const registry = createSlashRegistry({ commands: [spec] });

    // list() includes all commands (hidden or not)
    const all = registry.list();
    expect(all.some((c) => c.name === '/internal-cmd')).toBe(true);

    // suggest() excludes hidden
    const suggestions = registry.suggest('/');
    expect(suggestions.some((s) => s.name.trim() === '/internal-cmd')).toBe(false);
  });

  it('property: no hidden skill ever appears in suggestions', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: validNameArb,
            hidden: fc.boolean(),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        (skillDefs) => {
          // Deduplicate names
          const seen = new Set<string>();
          const unique = skillDefs.filter((s) => {
            if (seen.has(s.name)) return false;
            seen.add(s.name);
            return true;
          });

          const specs: SlashCommandSpec[] = unique.map((s) => ({
            name: `/${s.name}`,
            description: `Skill: ${s.name}`,
            hidden: s.hidden,
            order: 220,
          }));

          const registry = createSlashRegistry({ commands: specs });
          const suggestions = registry.suggest('/');
          const suggestedNames = new Set(suggestions.map((s) => s.name.trim()));

          for (const s of unique) {
            if (s.hidden) {
              expect(suggestedNames.has(`/${s.name}`)).toBe(false);
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
