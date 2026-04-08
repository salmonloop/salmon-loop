/**
 * Unit tests for catalog disclosure formatting.
 *
 * Tests filtering logic, output format, preamble content, and conditional path handling
 * for SkillLoader.formatCatalogDisclosure().
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.7
 */
import { describe, it, expect } from 'bun:test';

import { SkillLoader } from '../../../src/core/skills/loader.js';
import { SkillCatalogEntry } from '../../../src/core/skills/types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<SkillCatalogEntry> & { name: string }): SkillCatalogEntry {
  return {
    ...overrides,
    id: overrides.id ?? overrides.name,
    name: overrides.name,
    description: overrides.description ?? `Description for ${overrides.name}`,
    location: overrides.location ?? `.salmonloop/skills/${overrides.name}/SKILL.md`,
    scope: overrides.scope ?? 'repo',
  };
}

// ── Empty / fully-filtered catalogs ──────────────────────────────────

describe('Catalog disclosure — empty results', () => {
  it('returns empty string for empty catalog', () => {
    const result = SkillLoader.formatCatalogDisclosure([]);
    expect(result).toBe('');
  });

  it('returns empty string when all entries have userInvocable=false', () => {
    const catalog: SkillCatalogEntry[] = [
      makeEntry({ name: 'hidden-a', userInvocable: false }),
      makeEntry({ name: 'hidden-b', userInvocable: false }),
    ];
    const result = SkillLoader.formatCatalogDisclosure(catalog);
    expect(result).toBe('');
  });

  it('returns empty string when all entries are conditional with no context paths', () => {
    const catalog: SkillCatalogEntry[] = [
      makeEntry({ name: 'cond-a', conditionalPaths: ['**/*.ts'] }),
      makeEntry({ name: 'cond-b', conditionalPaths: ['src/**'] }),
    ];
    const result = SkillLoader.formatCatalogDisclosure(catalog);
    expect(result).toBe('');
  });
});

// ── Output format ────────────────────────────────────────────────────

describe('Catalog disclosure — output format', () => {
  it('output contains the preamble text', () => {
    const catalog = [makeEntry({ name: 'my-skill' })];
    const result = SkillLoader.formatCatalogDisclosure(catalog);

    expect(result).toContain('## Available Skills');
    expect(result).toContain(
      'The following skills provide specialized instructions for specific tasks.',
    );
    expect(result).toContain(
      'read the SKILL.md file at the listed location to load detailed instructions before proceeding',
    );
  });

  it('output contains per-entry format: - **name**: description\\n  Location: path', () => {
    const catalog = [
      makeEntry({
        name: 'code-review',
        description: 'Reviews code for quality',
        location: '.salmonloop/skills/code-review/SKILL.md',
      }),
    ];
    const result = SkillLoader.formatCatalogDisclosure(catalog);

    expect(result).toContain('- **code-review**: Reviews code for quality');
    expect(result).toContain('  Location: .salmonloop/skills/code-review/SKILL.md');
  });
});

// ── userInvocable filtering ──────────────────────────────────────────

describe('Catalog disclosure — userInvocable filtering', () => {
  it('excludes entry with userInvocable=false', () => {
    const catalog = [
      makeEntry({ name: 'visible-skill' }),
      makeEntry({ name: 'hidden-skill', userInvocable: false }),
    ];
    const result = SkillLoader.formatCatalogDisclosure(catalog);

    expect(result).toContain('visible-skill');
    expect(result).not.toContain('hidden-skill');
  });

  it('includes entry with userInvocable=true', () => {
    const catalog = [makeEntry({ name: 'explicit-true', userInvocable: true })];
    const result = SkillLoader.formatCatalogDisclosure(catalog);
    expect(result).toContain('explicit-true');
  });

  it('includes entry with userInvocable=undefined (default)', () => {
    const catalog = [makeEntry({ name: 'default-invocable' })];
    const result = SkillLoader.formatCatalogDisclosure(catalog);
    expect(result).toContain('default-invocable');
  });
});


// ── Conditional path filtering ───────────────────────────────────────

describe('Catalog disclosure — conditional path filtering', () => {
  it('excludes conditional entry when no context paths provided', () => {
    const catalog = [makeEntry({ name: 'ts-only', conditionalPaths: ['**/*.ts'] })];
    const result = SkillLoader.formatCatalogDisclosure(catalog, undefined);
    expect(result).toBe('');
  });

  it('excludes conditional entry when empty context paths provided', () => {
    const catalog = [makeEntry({ name: 'ts-only', conditionalPaths: ['**/*.ts'] })];
    const result = SkillLoader.formatCatalogDisclosure(catalog, []);
    expect(result).toBe('');
  });

  it('includes conditional entry when matching context path provided', () => {
    const catalog = [makeEntry({ name: 'ts-only', conditionalPaths: ['**/*.ts'] })];
    const result = SkillLoader.formatCatalogDisclosure(catalog, ['src/index.ts']);
    expect(result).toContain('ts-only');
  });

  it('excludes conditional entry when non-matching context path provided', () => {
    const catalog = [makeEntry({ name: 'ts-only', conditionalPaths: ['**/*.ts'] })];
    const result = SkillLoader.formatCatalogDisclosure(catalog, ['src/styles.css']);
    expect(result).toBe('');
  });
});

// ── Multiple entries ─────────────────────────────────────────────────

describe('Catalog disclosure — multiple entries', () => {
  it('includes all entries that pass filtering', () => {
    const catalog = [
      makeEntry({ name: 'skill-alpha', description: 'Alpha skill' }),
      makeEntry({ name: 'skill-beta', description: 'Beta skill' }),
      makeEntry({ name: 'skill-gamma', description: 'Gamma skill', userInvocable: false }),
      makeEntry({ name: 'skill-delta', description: 'Delta skill', conditionalPaths: ['**/*.ts'] }),
    ];
    const result = SkillLoader.formatCatalogDisclosure(catalog, ['src/main.ts']);

    // Non-conditional invocable entries included
    expect(result).toContain('skill-alpha');
    expect(result).toContain('skill-beta');
    // userInvocable=false excluded
    expect(result).not.toContain('skill-gamma');
    // Conditional entry included because context path matches
    expect(result).toContain('skill-delta');
  });
});
