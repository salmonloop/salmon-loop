/**
 * Property-based tests for lenient/strict frontmatter parsing.
 *
 * Feature: agentskills-spec-compliance
 *
 * Property 1: Lenient mode loads skills with non-fatal frontmatter violations
 * Property 2: Strict mode rejects non-fatal frontmatter violations (added by task 2.5)
 * Property 3: Valid skills parse identically in lenient mode (added by task 2.6)
 *
 * Validates: Requirements 1.1, 1.2, 1.4, 1.6, 1.9, 1.10, 2.5
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';

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

/** Generates valid skill names: lowercase alphanumeric + single hyphens, ≤64 chars. */
const validNameArb = fc
  .tuple(
    alnumSegmentArb,
    fc.array(alnumSegmentArb, { minLength: 0, maxLength: 3 }),
  )
  .map(([head, segments]) => segments.length === 0 ? head : head + '-' + segments.join('-'))
  .filter((s) => s.length >= 1 && s.length <= 64);

/**
 * Generates safe YAML description strings (no special chars that break YAML).
 * Always starts with a letter to prevent YAML from interpreting as a number/boolean.
 */
const safeDescArb = fc
  .tuple(
    fc.constantFrom(...ALPHA_CHARS),
    fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), { minLength: 1, maxLength: 49 }),
  )
  .map(([first, rest]) => (first + rest.join('')).trim())
  .filter((s) => s.length > 0);

// ── Non-fatal violation arbitraries ──────────────────────────────────

/**
 * Generates names that exceed 64 characters.
 * Uses valid lowercase alphanumeric chars so the ONLY violation is length.
 */
const nameTooLongArb = fc
  .array(fc.constantFrom(...ALNUM_CHARS), { minLength: 65, maxLength: 120 })
  .map((chars) => {
    // Ensure starts with a letter (not digit) for YAML safety
    const str = chars.join('');
    return ALPHA_CHARS.includes(str[0]) ? str : 'a' + str.slice(1);
  });

/**
 * Generates names that violate the naming regex but are non-empty strings.
 * These include uppercase letters, special characters, leading/trailing hyphens,
 * and consecutive hyphens.
 */
const regexViolatingNameArb = fc.oneof(
  // Uppercase letters
  fc.constant('MySkill'),
  fc.constant('ALLCAPS'),
  fc.constant('camelCase'),
  // Leading hyphen
  fc.constant('-leading'),
  // Trailing hyphen
  fc.constant('trailing-'),
  // Consecutive hyphens
  fc.constant('bad--name'),
  fc.constant('a--b--c'),
  // Special characters (underscore, dot, space)
  fc.constant('under_score'),
  fc.constant('dot.name'),
  fc.constant('has space'),
  // Mixed violations
  fc.constant('Bad--Name'),
  fc.constant('-Upper-'),
);

/**
 * Generates descriptions that exceed 1024 characters.
 * Uses safe alphanumeric chars so the ONLY violation is length.
 */
const descTooLongArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')), { minLength: 1025, maxLength: 1200 })
  .map((chars) => chars.join('').trim())
  .filter((s) => s.length > 1024);

/**
 * Generates a directory name that differs from the skill name,
 * producing a name-directory mismatch.
 */
function mismatchedDirArb(name: string): fc.Arbitrary<string> {
  return validNameArb.filter((dir) => dir !== name);
}

// ── Property 1: Lenient mode loads non-fatal violations ──────────────

describe('Feature: agentskills-spec-compliance, Property 1: Lenient mode loads non-fatal violations', () => {
  /**
   * **Validates: Requirements 1.1, 1.2, 1.4, 1.6**
   *
   * For any SKILL.md whose frontmatter has a non-empty name string and a
   * non-empty description string, but violates one or more non-fatal
   * constraints (name exceeds 64 chars, name violates naming regex,
   * name-directory mismatch, description exceeds 1024 chars), parsing in
   * lenient mode (strict=false) SHALL return a valid Skill object with the
   * original name and description preserved — not throw an error.
   */

  it('loads skills with names exceeding 64 characters', () => {
    fc.assert(
      fc.property(nameTooLongArb, safeDescArb, (longName, desc) => {
        const content = buildSkillMd({ name: longName, description: desc });
        const filePath = pathForName(longName);

        const skill = SkillParser.parse(content, filePath, false);

        expect(skill).toBeDefined();
        expect(skill.id).toBe(longName);
        expect(skill.metadata.name).toBe(longName);
        expect(skill.metadata.description).toBe(desc);
        expect(skill.instructions).toBe('Instructions here.');
      }),
      { numRuns: 100 },
    );
  });

  it('loads skills with regex-violating names', () => {
    fc.assert(
      fc.property(regexViolatingNameArb, safeDescArb, (badName, desc) => {
        // Quote the name to handle special chars in YAML
        const content = buildSkillMd({ name: `"${badName}"`, description: desc });
        const filePath = pathForName(badName);

        const skill = SkillParser.parse(content, filePath, false);

        expect(skill).toBeDefined();
        expect(skill.id).toBe(badName);
        expect(skill.metadata.name).toBe(badName);
        expect(skill.metadata.description).toBe(desc);
      }),
      { numRuns: 100 },
    );
  });

  it('loads skills with name-directory mismatch', () => {
    fc.assert(
      fc.property(validNameArb, safeDescArb, (name, desc) => {
        const content = buildSkillMd({ name, description: desc });
        // Use a different directory name to create a mismatch
        const filePath = `skills/different-dir/SKILL.md`;

        fc.pre(name !== 'different-dir');

        const skill = SkillParser.parse(content, filePath, false);

        expect(skill).toBeDefined();
        expect(skill.id).toBe(name);
        expect(skill.metadata.name).toBe(name);
        expect(skill.metadata.description).toBe(desc);
      }),
      { numRuns: 100 },
    );
  });

  it('loads skills with descriptions exceeding 1024 characters', () => {
    fc.assert(
      fc.property(validNameArb, descTooLongArb, (name, longDesc) => {
        // Quote the long description to keep YAML valid
        const escaped = longDesc.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const content = buildSkillMd({ name, description: `"${escaped}"` });
        const filePath = pathForName(name);

        const skill = SkillParser.parse(content, filePath, false);

        expect(skill).toBeDefined();
        expect(skill.id).toBe(name);
        expect(skill.metadata.name).toBe(name);
        expect(skill.metadata.description).toBe(longDesc);
      }),
      { numRuns: 100 },
    );
  });

  it('loads skills with multiple simultaneous non-fatal violations', () => {
    fc.assert(
      fc.property(
        nameTooLongArb,
        descTooLongArb,
        (longName, longDesc) => {
          // Name is too long AND description is too long
          const escaped = longDesc.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const content = buildSkillMd({
            name: longName,
            description: `"${escaped}"`,
          });
          // Also create a directory mismatch
          const filePath = `skills/other-dir/SKILL.md`;

          const skill = SkillParser.parse(content, filePath, false);

          expect(skill).toBeDefined();
          expect(skill.id).toBe(longName);
          expect(skill.metadata.name).toBe(longName);
          expect(skill.metadata.description).toBe(longDesc);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 2: Strict mode rejects non-fatal violations ─────────────

describe('Feature: agentskills-spec-compliance, Property 2: Strict mode rejects non-fatal violations', () => {
  /**
   * **Validates: Requirements 1.9**
   *
   * For any SKILL.md whose frontmatter name violates the naming regex,
   * exceeds 64 characters, does not match the parent directory, or whose
   * description exceeds 1024 characters, parsing in strict mode (strict=true)
   * SHALL throw an error.
   */

  it('rejects names exceeding 64 characters in strict mode', () => {
    fc.assert(
      fc.property(nameTooLongArb, safeDescArb, (longName, desc) => {
        const content = buildSkillMd({ name: longName, description: desc });
        const filePath = pathForName(longName);

        expect(() => SkillParser.parse(content, filePath, true)).toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('rejects regex-violating names in strict mode', () => {
    fc.assert(
      fc.property(regexViolatingNameArb, safeDescArb, (badName, desc) => {
        // Quote the name to handle special chars in YAML
        const content = buildSkillMd({ name: `"${badName}"`, description: desc });
        const filePath = pathForName(badName);

        expect(() => SkillParser.parse(content, filePath, true)).toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('rejects name-directory mismatch in strict mode', () => {
    fc.assert(
      fc.property(validNameArb, safeDescArb, (name, desc) => {
        const content = buildSkillMd({ name, description: desc });
        // Use a different directory name to create a mismatch
        const filePath = `skills/different-dir/SKILL.md`;

        fc.pre(name !== 'different-dir');

        expect(() => SkillParser.parse(content, filePath, true)).toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('rejects descriptions exceeding 1024 characters in strict mode', () => {
    fc.assert(
      fc.property(validNameArb, descTooLongArb, (name, longDesc) => {
        // Quote the long description to keep YAML valid
        const escaped = longDesc.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const content = buildSkillMd({ name, description: `"${escaped}"` });
        const filePath = pathForName(name);

        expect(() => SkillParser.parse(content, filePath, true)).toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('rejects multiple simultaneous non-fatal violations in strict mode', () => {
    fc.assert(
      fc.property(
        nameTooLongArb,
        descTooLongArb,
        (longName, longDesc) => {
          // Name is too long AND description is too long
          const escaped = longDesc.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const content = buildSkillMd({
            name: longName,
            description: `"${escaped}"`,
          });
          // Also create a directory mismatch
          const filePath = `skills/other-dir/SKILL.md`;

          expect(() => SkillParser.parse(content, filePath, true)).toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 3: Valid skills parse identically ───────────────────────

describe('Feature: agentskills-spec-compliance, Property 3: Valid skills parse identically', () => {
  /**
   * **Validates: Requirements 1.10, 2.5**
   *
   * For any SKILL.md with a conforming frontmatter (name matches regex,
   * ≤64 chars, matches parent directory; description non-empty, ≤1024 chars;
   * valid YAML), parsing in lenient mode SHALL produce a Skill object
   * identical to parsing in strict mode — same id, metadata, and instructions.
   */

  it('produces identical id, metadata, and instructions in both modes', () => {
    fc.assert(
      fc.property(validNameArb, safeDescArb, (name, desc) => {
        const body = 'Follow these instructions carefully.';
        const content = buildSkillMd({ name, description: desc }, body);
        const filePath = pathForName(name);

        const lenient = SkillParser.parse(content, filePath, false);
        const strict = SkillParser.parse(content, filePath, true);

        // Core identity must be identical
        expect(lenient.id).toBe(strict.id);

        // Metadata fields must match
        expect(lenient.metadata.name).toBe(strict.metadata.name);
        expect(lenient.metadata.description).toBe(strict.metadata.description);
        expect(lenient.metadata.license).toBe(strict.metadata.license);
        expect(lenient.metadata.compatibility).toBe(strict.metadata.compatibility);
        expect(lenient.metadata.metadata).toEqual(strict.metadata.metadata);
        expect(lenient.metadata['allowed-tools']).toBe(strict.metadata['allowed-tools']);
        expect(lenient.metadata.allowedTools).toEqual(strict.metadata.allowedTools);
        expect(lenient.metadata.context).toBe(strict.metadata.context);
        expect(lenient.metadata.userInvocable).toBe(strict.metadata.userInvocable);
        expect(lenient.metadata.paths).toEqual(strict.metadata.paths);

        // Instructions must be identical
        expect(lenient.instructions).toBe(strict.instructions);
      }),
      { numRuns: 100 },
    );
  });

  it('produces identical results with optional frontmatter fields', () => {
    fc.assert(
      fc.property(
        validNameArb,
        safeDescArb,
        fc.constantFrom('MIT', 'Apache-2.0', 'ISC'),
        fc.constantFrom('fork', 'main') as fc.Arbitrary<'fork' | 'main'>,
        (name, desc, license, context) => {
          const body = 'Extended instructions with optional fields.';
          const content = buildSkillMd(
            { name, description: desc, license, context },
            body,
          );
          const filePath = pathForName(name);

          const lenient = SkillParser.parse(content, filePath, false);
          const strict = SkillParser.parse(content, filePath, true);

          expect(lenient.id).toBe(strict.id);
          expect(lenient.metadata.name).toBe(strict.metadata.name);
          expect(lenient.metadata.description).toBe(strict.metadata.description);
          expect(lenient.metadata.license).toBe(strict.metadata.license);
          expect(lenient.metadata.context).toBe(strict.metadata.context);
          expect(lenient.instructions).toBe(strict.instructions);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('produces identical results with multiline instruction bodies', () => {
    // Generate safe body lines using the same char set as safeDescArb
    const bodyLineArb = fc
      .tuple(
        fc.constantFrom(...ALPHA_CHARS),
        fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz 0123456789'.split('')), { minLength: 1, maxLength: 60 }),
      )
      .map(([first, rest]) => first + rest.join(''));

    fc.assert(
      fc.property(
        validNameArb,
        safeDescArb,
        fc.array(bodyLineArb, { minLength: 1, maxLength: 5 }),
        (name, desc, bodyLines) => {
          const body = bodyLines.join('\n');
          const content = buildSkillMd({ name, description: desc }, body);
          const filePath = pathForName(name);

          const lenient = SkillParser.parse(content, filePath, false);
          const strict = SkillParser.parse(content, filePath, true);

          expect(lenient.id).toBe(strict.id);
          expect(lenient.metadata).toEqual(strict.metadata);
          expect(lenient.instructions).toBe(strict.instructions);
        },
      ),
      { numRuns: 100 },
    );
  });
});
