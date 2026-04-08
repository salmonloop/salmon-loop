/**
 * Property-based tests for YAML fallback recovery.
 *
 * Feature: agentskills-spec-compliance
 *
 * Property 4: YAML fallback fixes unquoted colons into parseable YAML
 *
 * Validates: Requirements 2.1, 2.6
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';
import { parse as parseYaml } from 'yaml';

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

// ── fast-check arbitraries ───────────────────────────────────────────

const ALPHA_CHARS = 'abcdefghijklmnopqrstuvwxyz'.split('');

/**
 * Generates simple lowercase YAML keys (like "description", "name", "title").
 * Starts with a letter, contains only lowercase letters.
 */
const yamlKeyArb = fc
  .tuple(
    fc.constantFrom(...ALPHA_CHARS),
    fc.array(fc.constantFrom(...ALPHA_CHARS), { minLength: 2, maxLength: 12 }),
  )
  .map(([first, rest]) => first + rest.join(''));

/**
 * Generates safe text segments that won't break YAML structurally.
 * Avoids characters that are YAML structural indicators.
 */
const safeTextArb = fc
  .array(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
    ),
    { minLength: 1, maxLength: 30 },
  )
  .map((chars) => chars.join('').trim())
  .filter((s) => s.length > 0);

/**
 * Generates values that contain `: ` (colon-space) sequences — the pattern
 * that causes YAML parsing failures when unquoted.
 *
 * Format: `<text>: <text>` — e.g. "Use when: user asks about PDFs"
 */
const valueWithColonArb = fc
  .tuple(safeTextArb, safeTextArb)
  .map(([before, after]) => `${before}: ${after}`);

/**
 * Generates a single YAML key-value line where the value contains an unquoted colon.
 * This is the exact pattern that fixCommonYamlIssues targets.
 */
const keyValueWithColonArb = fc
  .tuple(yamlKeyArb, valueWithColonArb)
  .map(([key, value]) => ({ key, value, line: `${key}: ${value}` }));

/**
 * Generates multiple YAML key-value lines, at least one with an unquoted colon.
 * Includes a mandatory `name` and `description` field to form realistic frontmatter.
 */
const yamlBlockArb = fc
  .tuple(
    yamlKeyArb,                // extra key for the colon-containing line
    valueWithColonArb,         // value with colon for that key
    fc.array(                  // additional safe key-value pairs
      fc.tuple(yamlKeyArb, safeTextArb),
      { minLength: 0, maxLength: 3 },
    ),
  )
  .map(([colonKey, colonValue, extras]) => {
    const lines: string[] = [];
    // Add the problematic line with unquoted colon in value
    lines.push(`${colonKey}: ${colonValue}`);
    // Add extra safe lines
    for (const [k, v] of extras) {
      lines.push(`${k}: ${v}`);
    }
    return {
      yamlContent: lines.join('\n'),
      colonKey,
      colonValue,
    };
  });

// ── Property 4: YAML fallback fixes unquoted colons ──────────────────

describe('Feature: agentskills-spec-compliance, Property 4: YAML fallback fixes unquoted colons', () => {
  /**
   * **Validates: Requirements 2.1, 2.6**
   *
   * For any YAML key-value line where the value portion contains an unquoted
   * colon (e.g. `description: Use when: user asks`), applying
   * `fixCommonYamlIssues` SHALL produce a string that the YAML parser can
   * parse successfully, and the parsed value SHALL preserve the original
   * semantic content (the full value including the colon).
   */

  it('produces parseable YAML from single key-value lines with unquoted colons', () => {
    fc.assert(
      fc.property(keyValueWithColonArb, ({ key, value, line }) => {
        const { fixed, correctedLines } = SkillParser.fixCommonYamlIssues(line);

        // The fixed output must be parseable by the YAML library
        const parsed = parseYaml(fixed);
        expect(parsed).toBeDefined();
        expect(typeof parsed).toBe('object');

        // The parsed value must preserve the original semantic content
        // (the full value string including the colon)
        expect(parsed[key]).toBe(value);

        // The method must have identified this line as corrected
        expect(correctedLines.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('produces parseable YAML from multi-line blocks with unquoted colons', () => {
    fc.assert(
      fc.property(yamlBlockArb, ({ yamlContent, colonKey, colonValue }) => {
        const { fixed } = SkillParser.fixCommonYamlIssues(yamlContent);

        // The fixed output must be parseable by the YAML library
        const parsed = parseYaml(fixed);
        expect(parsed).toBeDefined();
        expect(typeof parsed).toBe('object');

        // The colon-containing value must be preserved in the parsed output
        expect(parsed[colonKey]).toBe(colonValue);
      }),
      { numRuns: 100 },
    );
  });

  it('preserves semantic content with multiple colons in a single value', () => {
    // Generate values with multiple `: ` sequences
    const multiColonValueArb = fc
      .tuple(safeTextArb, safeTextArb, safeTextArb)
      .map(([a, b, c]) => `${a}: ${b}: ${c}`);

    fc.assert(
      fc.property(yamlKeyArb, multiColonValueArb, (key, value) => {
        const yamlContent = `${key}: ${value}`;
        const { fixed } = SkillParser.fixCommonYamlIssues(yamlContent);

        // Must parse successfully
        const parsed = parseYaml(fixed);
        expect(parsed).toBeDefined();
        expect(typeof parsed).toBe('object');

        // The full value including all colons must be preserved
        expect(parsed[key]).toBe(value);
      }),
      { numRuns: 100 },
    );
  });

  it('does not alter lines without unquoted colons in values', () => {
    // Generate text values that start with a letter to avoid YAML type coercion
    // (pure digits → number, "true"/"false" → boolean, etc.)
    const safeStringValueArb = fc
      .tuple(
        fc.constantFrom(...ALPHA_CHARS),
        fc.array(
          fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
          { minLength: 1, maxLength: 20 },
        ),
      )
      .map(([first, rest]) => (first + rest.join('')).trim())
      .filter((s) => s.length > 0);

    fc.assert(
      fc.property(yamlKeyArb, safeStringValueArb, (key, value) => {
        const yamlContent = `${key}: ${value}`;
        const { fixed, correctedLines } = SkillParser.fixCommonYamlIssues(yamlContent);

        // No corrections should be made
        expect(correctedLines.length).toBe(0);

        // The output should be identical to the input
        expect(fixed).toBe(yamlContent);

        // Must still parse successfully
        const parsed = parseYaml(fixed);
        expect(String(parsed[key])).toBe(value);
      }),
      { numRuns: 100 },
    );
  });
});
