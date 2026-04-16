/**
 * Progressive disclosure tests — Property 10: Token Bound.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 10.1
 *
 * Property 10: Progressive Disclosure Token Bound
 * ∀ catalog ∈ SkillCatalogs: tokenCost(catalog) ≈ O(n × 75)
 * where n = |catalog| (sublinear in total skill content)
 *
 * - Catalog entries are lightweight (~50-100 tokens per skill)
 * - Unactivated skills have no instructions loaded
 * - Activated skills have full instructions and rawContent
 */
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { SkillLoader } from '../../../../src/core/skills/loader.js';
import type { SkillCatalogEntry } from '../../../../src/core/skills/types.js';

// --- Helpers ---

function skillContent(name: string, description: string, body?: string): string {
  const instructions = body ?? `Full instructions here for ${name}. `.repeat(20);
  return `---\nname: ${name}\ndescription: "${description}"\n---\n${instructions}\n`;
}

async function createSkillTree(
  baseDir: string,
  skills: Array<{ name: string; description: string; body?: string }>,
): Promise<void> {
  const fs = await import('node:fs/promises');
  for (const skill of skills) {
    const skillDir = path.join(baseDir, skill.name);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      skillContent(skill.name, skill.description, skill.body),
    );
  }
}

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

describe('Property 10: Progressive Disclosure Token Bound', () => {
  let tmpDir: string;

  beforeEach(async () => {
    const fs = await import('node:fs/promises');
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'progressive-disclosure-test-'));
  });

  afterEach(async () => {
    const fs = await import('node:fs/promises');
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * **Validates: Requirements 6.1, 6.3**
   *
   * A single catalog entry should cost well under 100 tokens.
   * Estimate: name (~20 chars) + description (~50 chars) + location (~40 chars)
   * + scope (~4 chars) + JSON overhead ≈ ~28-50 tokens.
   */
  it('catalog entry token cost is under 100 tokens per skill', async () => {
    const skillsDir = path.join(tmpDir, '.salmonloop', 'skills');
    await createSkillTree(skillsDir, [
      { name: 'test-skill', description: 'A test skill for token measurement' },
    ]);

    const loader = new SkillLoader({ repoRoot: tmpDir });
    const catalog = await loader.loadCatalog();

    expect(catalog).toHaveLength(1);

    const entry = catalog[0];
    const serialized = JSON.stringify(entry);
    const tokens = estimateTokens(serialized);

    // Each catalog entry should be well under 100 tokens
    expect(tokens).toBeLessThanOrEqual(100);
  });

  /**
   * **Validates: Requirements 6.1, 6.3**
   *
   * With multiple skills, total catalog cost should scale linearly
   * with the number of skills (not with total instruction content).
   */
  it('catalog cost scales linearly with skill count, not content size', async () => {
    const skillsDir = path.join(tmpDir, '.salmonloop', 'skills');
    const skills = Array.from({ length: 5 }, (_, i) => ({
      name: `skill-${String(i).padStart(2, '0')}`,
      description: `Skill number ${i}`,
      // Each skill has a large instruction body
      body: `Very detailed instructions. `.repeat(100),
    }));
    await createSkillTree(skillsDir, skills);

    const loader = new SkillLoader({ repoRoot: tmpDir });
    const catalog = await loader.loadCatalog();

    expect(catalog).toHaveLength(5);

    const totalCatalogJson = JSON.stringify(catalog);
    const totalCatalogTokens = estimateTokens(totalCatalogJson);

    // 5 skills × ~100 tokens max each = ~500 tokens max for the catalog
    // The actual instruction content is ~2600 chars × 5 = ~13000 chars = ~3250 tokens
    // Catalog should be a small fraction of full content
    expect(totalCatalogTokens).toBeLessThanOrEqual(500);

    // Verify catalog is significantly smaller than full content would be
    const fullSkills = await loader.initialize();
    const totalFullJson = JSON.stringify(fullSkills);
    const totalFullTokens = estimateTokens(totalFullJson);

    expect(totalCatalogTokens).toBeLessThan(totalFullTokens * 0.5);
  });

  /**
   * **Validates: Requirements 6.1, 6.3**
   *
   * Catalog entries must NOT contain instructions or rawContent fields.
   */
  it('catalog entry does not contain instructions or rawContent', async () => {
    const skillsDir = path.join(tmpDir, '.salmonloop', 'skills');
    await createSkillTree(skillsDir, [{ name: 'lean-skill', description: 'Lean catalog entry' }]);

    const loader = new SkillLoader({ repoRoot: tmpDir });
    const catalog = await loader.loadCatalog();

    expect(catalog).toHaveLength(1);
    const entry = catalog[0] as unknown as Record<string, unknown>;

    // These fields must be absent from catalog entries
    expect(entry['instructions']).toBeUndefined();
    expect(entry['rawContent']).toBeUndefined();

    // Only expected fields should be present
    const keys = Object.keys(entry).sort();
    expect(keys).toEqual(
      expect.arrayContaining(['id', 'name', 'description', 'location', 'scope']),
    );
  });
});

describe('Progressive Disclosure: Unactivated vs Activated', () => {
  let tmpDir: string;

  beforeEach(async () => {
    const fs = await import('node:fs/promises');
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'activation-test-'));
  });

  afterEach(async () => {
    const fs = await import('node:fs/promises');
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * **Validates: Requirements 6.1, 6.2**
   *
   * After loadCatalog(), the returned entries should NOT have
   * instructions or rawContent fields — only lightweight metadata.
   */
  it('unactivated skill has no instructions loaded', async () => {
    const skillsDir = path.join(tmpDir, '.salmonloop', 'skills');
    await createSkillTree(skillsDir, [
      {
        name: 'unactivated-skill',
        description: 'Should not have instructions in catalog',
        body: 'These instructions should NOT appear in the catalog entry.',
      },
    ]);

    const loader = new SkillLoader({ repoRoot: tmpDir });
    const catalog = await loader.loadCatalog();

    expect(catalog).toHaveLength(1);
    const entry: SkillCatalogEntry = catalog[0];

    // Catalog entry has metadata only
    expect(entry.id).toBe('unactivated-skill');
    expect(entry.name).toBe('unactivated-skill');
    expect(entry.description).toBe('Should not have instructions in catalog');

    // No instruction content present
    const asRecord = entry as unknown as Record<string, unknown>;
    expect(asRecord['instructions']).toBeUndefined();
    expect(asRecord['rawContent']).toBeUndefined();
  });

  /**
   * **Validates: Requirements 6.2, 6.4**
   *
   * After activateSkill(id), the returned Skill should have
   * instructions and rawContent populated with full content.
   */
  it('activated skill has full instructions and rawContent', async () => {
    const skillsDir = path.join(tmpDir, '.salmonloop', 'skills');
    const instructionBody = 'Step 1: Do this.\nStep 2: Do that.\nStep 3: Done.';
    await createSkillTree(skillsDir, [
      {
        name: 'activated-skill',
        description: 'Should have full instructions after activation',
        body: instructionBody,
      },
    ]);

    const loader = new SkillLoader({ repoRoot: tmpDir });
    const skill = await loader.activateSkill('activated-skill');

    expect(skill.id).toBe('activated-skill');
    expect(skill.metadata.name).toBe('activated-skill');
    expect(skill.metadata.description).toBe('Should have full instructions after activation');

    // Full content is loaded
    expect(skill.instructions).toBe(instructionBody);
    expect(skill.rawContent).toContain(instructionBody);
    expect(skill.rawContent).toContain('---');
  });

  /**
   * **Validates: Requirements 6.2, 6.4**
   *
   * The transition from catalog-only to activated should load
   * instructions that were absent in the catalog entry.
   */
  it('catalog entry and activated skill differ in content fields', async () => {
    const skillsDir = path.join(tmpDir, '.salmonloop', 'skills');
    await createSkillTree(skillsDir, [
      {
        name: 'transition-skill',
        description: 'Test catalog-to-activation transition',
        body: 'Detailed instructions for the skill.',
      },
    ]);

    const loader = new SkillLoader({ repoRoot: tmpDir });

    // Tier 1: catalog only
    const catalog = await loader.loadCatalog();
    expect(catalog).toHaveLength(1);
    const catalogEntry = catalog[0] as unknown as Record<string, unknown>;
    expect(catalogEntry['instructions']).toBeUndefined();

    // Tier 2: activate
    const skill = await loader.activateSkill('transition-skill');
    expect(skill.instructions).toBe('Detailed instructions for the skill.');
    expect(skill.rawContent).toBeDefined();
    expect(skill.rawContent.length).toBeGreaterThan(0);
  });
});
