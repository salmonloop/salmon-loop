/**
 * Property-based tests for glob pattern matching in allowed-tools.
 *
 * Feature: agentskills-spec-compliance
 *
 * Property 5: Glob matching correctness
 * Property 6: Allowed-tools set OR semantics (added by task 5.4)
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */
import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';

import { matchAllowedTool, isToolPermitted } from '../../../src/core/skills/runtime/SkillRunner.js';

// ── Reference implementation ─────────────────────────────────────────

/**
 * Reference glob matcher using regex conversion.
 *
 * Converts a pattern to a regex by escaping all regex-special characters
 * except `*`, which becomes `.*`. Wraps in `^...$` anchors.
 * Case-sensitive. Treats `?`, `[`, `]` as literal characters.
 */
function referenceGlobMatch(pattern: string, toolName: string): boolean {
  if (!pattern.includes('*')) {
    return pattern === toolName;
  }

  // Escape all regex-special chars except `*`
  const escaped = pattern.replace(/([.+?^${}()|[\]\\])/g, '\\$1');
  // Replace `*` with `.*`
  const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
  const regex = new RegExp(regexStr);
  return regex.test(toolName);
}

// ── fast-check arbitraries ───────────────────────────────────────────

/** Characters used in tool names: lowercase letters, dots, hyphens. */
const TOOL_CHARS = 'abcdefghijklmnopqrstuvwxyz.-'.split('');

/** Characters used in patterns: lowercase letters, dots, hyphens, and `*`. */
const PATTERN_CHARS = 'abcdefghijklmnopqrstuvwxyz.-*'.split('');

/**
 * Generates tool name strings using lowercase letters, dots, and hyphens.
 * Non-empty, up to 30 characters.
 */
const toolNameArb = fc
  .array(fc.constantFrom(...TOOL_CHARS), { minLength: 1, maxLength: 30 })
  .map((chars) => chars.join(''));

/**
 * Generates pattern strings using lowercase letters, dots, hyphens, and `*`.
 * Non-empty, up to 30 characters.
 */
const patternArb = fc
  .array(fc.constantFrom(...PATTERN_CHARS), { minLength: 1, maxLength: 30 })
  .map((chars) => chars.join(''));

/** Generates patterns that contain no `*` (exact match patterns). */
const exactPatternArb = fc
  .array(fc.constantFrom(...TOOL_CHARS), { minLength: 1, maxLength: 30 })
  .map((chars) => chars.join(''));

/** Generates patterns that contain at least one `*`. */
const globPatternArb = fc
  .tuple(
    fc.array(fc.constantFrom(...TOOL_CHARS), { minLength: 0, maxLength: 10 }),
    fc.array(
      fc.tuple(
        fc.constant('*'),
        fc.array(fc.constantFrom(...TOOL_CHARS), { minLength: 0, maxLength: 10 }),
      ),
      { minLength: 1, maxLength: 3 },
    ),
  )
  .map(([prefix, segments]) => {
    let result = prefix.join('');
    for (const [star, suffix] of segments) {
      result += star + suffix.join('');
    }
    return result;
  });

// ── Property 5: Glob matching correctness ────────────────────────────

describe('Feature: agentskills-spec-compliance, Property 5: Glob matching correctness', () => {
  /**
   * **Validates: Requirements 3.1, 3.2, 3.6**
   *
   * For any pattern string and tool name string, matchAllowedTool(pattern, toolName)
   * SHALL return true if and only if: (a) the pattern contains no `*` and equals
   * the tool name exactly, OR (b) the pattern contains `*` characters and the tool
   * name matches the pattern where each `*` stands for zero or more arbitrary
   * characters. The match SHALL be case-sensitive and SHALL treat `?`, `[`, `]`
   * as literal characters.
   */

  it('matches the reference implementation for arbitrary patterns and tool names', () => {
    fc.assert(
      fc.property(patternArb, toolNameArb, (pattern, toolName) => {
        const actual = matchAllowedTool(pattern, toolName);
        const expected = referenceGlobMatch(pattern, toolName);
        expect(actual).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('exact patterns match only identical tool names', () => {
    fc.assert(
      fc.property(exactPatternArb, toolNameArb, (pattern, toolName) => {
        const result = matchAllowedTool(pattern, toolName);
        if (pattern === toolName) {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('glob patterns with * match according to wildcard semantics', () => {
    fc.assert(
      fc.property(globPatternArb, toolNameArb, (pattern, toolName) => {
        const actual = matchAllowedTool(pattern, toolName);
        const expected = referenceGlobMatch(pattern, toolName);
        expect(actual).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('treats ? and [ as literal characters, not wildcards', () => {
    // Generate patterns containing `?` or `[` alongside tool names
    const specialCharPatternArb = fc.oneof(
      // Patterns with `?`
      fc
        .tuple(
          fc.array(fc.constantFrom(...TOOL_CHARS), { minLength: 1, maxLength: 10 }),
          fc.array(fc.constantFrom(...TOOL_CHARS), { minLength: 0, maxLength: 10 }),
        )
        .map(([pre, post]) => pre.join('') + '?' + post.join('')),
      // Patterns with `[`
      fc
        .tuple(
          fc.array(fc.constantFrom(...TOOL_CHARS), { minLength: 1, maxLength: 10 }),
          fc.array(fc.constantFrom(...TOOL_CHARS), { minLength: 0, maxLength: 10 }),
        )
        .map(([pre, post]) => pre.join('') + '[' + post.join('')),
    );

    fc.assert(
      fc.property(specialCharPatternArb, toolNameArb, (pattern, toolName) => {
        const actual = matchAllowedTool(pattern, toolName);
        const expected = referenceGlobMatch(pattern, toolName);
        expect(actual).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('is case-sensitive', () => {
    fc.assert(
      fc.property(toolNameArb, (toolName) => {
        // Only test case sensitivity when the name has lowercase letters
        fc.pre(toolName !== toolName.toUpperCase());

        const upperName = toolName.toUpperCase();
        // Exact pattern with original case should match
        expect(matchAllowedTool(toolName, toolName)).toBe(true);
        // Exact pattern with different case should not match
        expect(matchAllowedTool(toolName, upperName)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 6: Allowed-tools set OR semantics ───────────────────────

/**
 * Arbitrary that generates a Set<string> of patterns (1–5 entries).
 * Each entry is a pattern string (may contain `*`).
 */
const patternSetArb = fc
  .array(patternArb, { minLength: 1, maxLength: 5 })
  .map((patterns) => new Set(patterns));

describe('Feature: agentskills-spec-compliance, Property 6: Allowed-tools set OR semantics', () => {
  /**
   * **Validates: Requirements 3.3, 3.4, 3.5**
   *
   * For any non-null allowed-tools set and any tool name, isToolPermitted(toolName, allowedSet)
   * SHALL return true if and only if at least one entry in the set matches the tool name
   * (via matchAllowedTool). When the set is null, it SHALL return true (no restriction).
   * When the set is non-null but empty (zero entries), no entry can match, so it SHALL
   * return false (deny all tools).
   */

  it('returns true when allowedTools is null (no restriction)', () => {
    fc.assert(
      fc.property(toolNameArb, (toolName) => {
        expect(isToolPermitted(toolName, null)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('returns false when allowedTools is an empty set (deny all)', () => {
    fc.assert(
      fc.property(toolNameArb, (toolName) => {
        expect(isToolPermitted(toolName, new Set())).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('returns true iff at least one pattern in the set matches the tool name', () => {
    fc.assert(
      fc.property(patternSetArb, toolNameArb, (allowedSet, toolName) => {
        const actual = isToolPermitted(toolName, allowedSet);

        // Reference: OR over all entries using the same matchAllowedTool function
        let expectedMatch = false;
        for (const pattern of allowedSet) {
          if (referenceGlobMatch(pattern, toolName)) {
            expectedMatch = true;
            break;
          }
        }

        expect(actual).toBe(expectedMatch);
      }),
      { numRuns: 100 },
    );
  });
});
