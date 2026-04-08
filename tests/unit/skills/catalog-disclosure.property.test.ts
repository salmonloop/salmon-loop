/**
 * Property-based tests for catalog disclosure filtering.
 *
 * Feature: agentskills-spec-compliance
 *
 * Property 7: Catalog disclosure includes exactly the disclosable skills
 *
 * Validates: Requirements 4.1, 4.2, 4.4, 4.5
 */
import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';

import { SkillLoader } from '../../../src/core/skills/loader.js';
import { SkillCatalogEntry } from '../../../src/core/skills/types.js';

// ── Reference implementation ─────────────────────────────────────────

/**
 * Reference filter that determines which catalog entries are disclosable.
 *
 * Rules:
 * 1. Exclude entries where `userInvocable === false`
 * 2. For entries with non-empty `conditionalPaths`:
 *    - If no contextFilePaths provided → exclude
 *    - Otherwise include only if at least one context path matches a conditional pattern
 * 3. Non-conditional entries with `userInvocable !== false` → always include
 */
function referenceDisclosable(
  catalog: SkillCatalogEntry[],
  contextFilePaths?: string[],
): SkillCatalogEntry[] {
  return catalog.filter(entry => {
    if (entry.userInvocable === false) return false;

    if (entry.conditionalPaths && entry.conditionalPaths.length > 0) {
      if (!contextFilePaths || contextFilePaths.length === 0) return false;
      return entry.conditionalPaths.some(pattern =>
        contextFilePaths.some(fp => referenceGlobMatch(fp, pattern)),
      );
    }

    return true;
  });
}

/**
 * Simple glob reference matcher for the test oracle.
 *
 * Supports `**` (any path segments) and `*` (any chars within a segment).
 * Normalizes backslashes to forward slashes.
 */
function referenceGlobMatch(filePath: string, pattern: string): boolean {
  const fp = filePath.replace(/\\/g, '/');
  const pat = pattern.replace(/\\/g, '/');

  let regexStr = '';
  let i = 0;
  while (i < pat.length) {
    const ch = pat[i];
    if (ch === '*' && pat[i + 1] === '*') {
      i += 2;
      if (pat[i] === '/') {
        i++;
        regexStr += '(?:.+/)?';
      } else {
        regexStr += '.*';
      }
    } else if (ch === '*') {
      regexStr += '[^/]*';
      i++;
    } else {
      regexStr += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }

  return new RegExp(`^${regexStr}$`).test(fp);
}

// ── fast-check arbitraries ───────────────────────────────────────────

/** Generate a random description string (1-50 chars). */
const descriptionArb = fc.string({ minLength: 1, maxLength: 50 });

/**
 * Generate simple conditional path patterns.
 * Uses file extension patterns that are realistic and exercise glob matching.
 */
const conditionalPathArb = fc.constantFrom(
  '**/*.ts',
  '**/*.js',
  '**/*.py',
  '**/*.md',
  '**/*.json',
  'src/**',
  'tests/**',
  'docs/**',
);

/** Generate a random userInvocable value: true, false, or undefined. */
const userInvocableArb = fc.constantFrom(true, false, undefined);

/** Generate an optional conditionalPaths array. */
const conditionalPathsArb = fc.oneof(
  fc.constant(undefined),
  fc.constant([] as string[]),
  fc.array(conditionalPathArb, { minLength: 1, maxLength: 3 }),
);

/**
 * Build a catalog entry from an index-based unique name.
 * Using index-prefixed names guarantees uniqueness and prevents substring collisions.
 */
function buildEntry(
  index: number,
  userInvocable: boolean | undefined,
  conditionalPaths: string[] | undefined,
  description: string,
): SkillCatalogEntry {
  const name = `skill${index}`;
  const entry: SkillCatalogEntry = {
    id: name,
    name,
    description,
    location: `.salmonloop/skills/${name}/SKILL.md`,
    scope: 'repo',
  };
  if (userInvocable !== undefined) {
    entry.userInvocable = userInvocable;
  }
  if (conditionalPaths && conditionalPaths.length > 0) {
    entry.conditionalPaths = conditionalPaths;
  }
  return entry;
}

/**
 * Generate a catalog of 0-8 entries with guaranteed unique names.
 * Each entry gets a unique index-based name to avoid name collisions.
 */
const uniqueCatalogArb = fc
  .array(
    fc.tuple(userInvocableArb, conditionalPathsArb, descriptionArb),
    { minLength: 0, maxLength: 8 },
  )
  .map(entries =>
    entries.map(([userInvocable, conditionalPaths, desc], idx) =>
      buildEntry(idx, userInvocable, conditionalPaths, desc),
    ),
  );

/** Generate context file paths that may or may not match conditional patterns. */
const contextFilePathArb = fc.constantFrom(
  'src/index.ts',
  'src/utils/helper.js',
  'tests/unit/foo.test.ts',
  'docs/README.md',
  'package.json',
  'config.py',
  'src/core/main.ts',
  'tests/integration/bar.js',
);

/** Generate an optional array of context file paths. */
const contextFilePathsArb = fc.oneof(
  fc.constant(undefined),
  fc.constant([] as string[]),
  fc.array(contextFilePathArb, { minLength: 1, maxLength: 5 }),
);

// ── Property 7: Catalog disclosure filtering ─────────────────────────

describe('Feature: agentskills-spec-compliance, Property 7: Catalog disclosure filtering', () => {
  /**
   * **Validates: Requirements 4.1, 4.2, 4.4, 4.5**
   *
   * For any catalog array and optional context file paths, formatCatalogDisclosure
   * SHALL include in its output every skill where userInvocable !== false AND
   * (the skill has no conditionalPaths, OR at least one context file path matches
   * a conditional path). Skills not meeting these criteria SHALL NOT appear.
   * When zero skills are disclosable, the output SHALL be an empty string.
   */

  it('output contains exactly the names of disclosable skills', () => {
    fc.assert(
      fc.property(uniqueCatalogArb, contextFilePathsArb, (catalog, contextFilePaths) => {
        const output = SkillLoader.formatCatalogDisclosure(catalog, contextFilePaths);
        const expected = referenceDisclosable(catalog, contextFilePaths);

        // Every disclosable skill name must appear in the output
        for (const entry of expected) {
          expect(output).toContain(entry.name);
        }

        // Every non-disclosable skill name must NOT appear in the output
        const nonDisclosable = catalog.filter(e => !expected.some(d => d.id === e.id));
        for (const entry of nonDisclosable) {
          expect(output).not.toContain(entry.name);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('returns empty string when zero skills are disclosable', () => {
    fc.assert(
      fc.property(uniqueCatalogArb, contextFilePathsArb, (catalog, contextFilePaths) => {
        const expected = referenceDisclosable(catalog, contextFilePaths);

        if (expected.length === 0) {
          const output = SkillLoader.formatCatalogDisclosure(catalog, contextFilePaths);
          expect(output).toBe('');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('excludes skills with userInvocable === false', () => {
    // Generate catalogs where at least one entry has userInvocable=false
    // The injected entry uses a unique prefix to avoid name collisions
    const catalogWithNonInvocableArb = fc
      .tuple(uniqueCatalogArb, descriptionArb)
      .map(([base, desc]) => {
        const nonInvocable: SkillCatalogEntry = {
          id: 'zznoninvocable',
          name: 'zznoninvocable',
          description: desc,
          location: '.salmonloop/skills/zznoninvocable/SKILL.md',
          scope: 'repo',
          userInvocable: false,
        };
        return [...base, nonInvocable];
      });

    fc.assert(
      fc.property(catalogWithNonInvocableArb, contextFilePathsArb, (catalog, contextFilePaths) => {
        const output = SkillLoader.formatCatalogDisclosure(catalog, contextFilePaths);

        // The injected non-invocable entry must never appear
        expect(output).not.toContain('zznoninvocable');
      }),
      { numRuns: 100 },
    );
  });

  it('excludes conditional skills when no context paths are provided', () => {
    // Generate catalogs where at least one entry has conditionalPaths
    // The injected entry uses a unique prefix to avoid name collisions
    const catalogWithConditionalArb = fc
      .tuple(
        uniqueCatalogArb,
        descriptionArb,
        fc.array(conditionalPathArb, { minLength: 1, maxLength: 3 }),
      )
      .map(([base, desc, condPaths]) => {
        const conditional: SkillCatalogEntry = {
          id: 'zzconditional',
          name: 'zzconditional',
          description: desc,
          location: '.salmonloop/skills/zzconditional/SKILL.md',
          scope: 'repo',
          conditionalPaths: condPaths,
        };
        return [...base, conditional];
      });

    fc.assert(
      fc.property(catalogWithConditionalArb, (catalog) => {
        // Call with no context paths (undefined)
        const output = SkillLoader.formatCatalogDisclosure(catalog, undefined);

        // The injected conditional entry must not appear without context paths
        expect(output).not.toContain('zzconditional');
      }),
      { numRuns: 100 },
    );
  });

  it('includes non-conditional skills with userInvocable !== false regardless of context paths', () => {
    // Generate catalogs with at least one non-conditional, invocable entry
    const catalogWithInvocableArb = fc
      .tuple(uniqueCatalogArb, descriptionArb)
      .map(([base, desc]) => {
        const invocable: SkillCatalogEntry = {
          id: 'zzinvocable',
          name: 'zzinvocable',
          description: desc,
          location: '.salmonloop/skills/zzinvocable/SKILL.md',
          scope: 'repo',
          // userInvocable defaults to true (undefined)
        };
        return [...base, invocable];
      });

    fc.assert(
      fc.property(catalogWithInvocableArb, contextFilePathsArb, (catalog, contextFilePaths) => {
        const output = SkillLoader.formatCatalogDisclosure(catalog, contextFilePaths);

        // The injected non-conditional invocable entry must always appear
        expect(output).toContain('zzinvocable');
      }),
      { numRuns: 100 },
    );
  });
});
