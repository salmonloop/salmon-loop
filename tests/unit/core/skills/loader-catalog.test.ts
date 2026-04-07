/**
 * Unit tests for SkillLoader.loadCatalog() — Tier 1 progressive disclosure.
 *
 * Validates: Requirements 6.1, 6.3
 */
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { SkillLoader } from '../../../../src/core/skills/loader.js';

// --- Helpers ---

function skillContent(name: string, description: string, paths?: string[]): string {
  const pathsLine = paths ? `\npaths:\n${paths.map(p => `  - "${p}"`).join('\n')}` : '';
  return `---\nname: ${name}\ndescription: "${description}"${pathsLine}\n---\nFull instructions here for ${name}.\n`;
}

/**
 * Create a temporary directory tree with skill files for testing.
 */
async function createSkillTree(
  baseDir: string,
  skills: Array<{ name: string; description: string; paths?: string[] }>,
): Promise<void> {
  const fs = await import('node:fs/promises');
  for (const skill of skills) {
    const skillDir = path.join(baseDir, skill.name);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      skillContent(skill.name, skill.description, skill.paths),
    );
  }
}

describe('SkillLoader.loadCatalog()', () => {
  let tmpDir: string;

  beforeEach(async () => {
    const fs = await import('node:fs/promises');
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-catalog-test-'));
  });

  afterEach(async () => {
    const fs = await import('node:fs/promises');
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns catalog entries with name, description, location, and scope', async () => {
    const skillsDir = path.join(tmpDir, '.salmonloop', 'skills');
    await createSkillTree(skillsDir, [
      { name: 'my-skill', description: 'A test skill' },
    ]);

    const loader = new SkillLoader({ repoRoot: tmpDir });
    const catalog = await loader.loadCatalog();

    expect(catalog).toHaveLength(1);
    const entry = catalog[0];
    expect(entry.id).toBe('my-skill');
    expect(entry.name).toBe('my-skill');
    expect(entry.description).toBe('A test skill');
    expect(entry.location).toContain('SKILL.md');
    expect(entry.scope).toBe('repo');
    // Catalog entries must NOT contain instructions
    expect(entry).not.toHaveProperty('instructions');
    expect(entry).not.toHaveProperty('rawContent');
  });

  it('does not load full instructions (Tier 1 only)', async () => {
    const skillsDir = path.join(tmpDir, '.salmonloop', 'skills');
    await createSkillTree(skillsDir, [
      { name: 'big-skill', description: 'Skill with large body' },
    ]);

    const loader = new SkillLoader({ repoRoot: tmpDir });
    const catalog = await loader.loadCatalog();

    expect(catalog).toHaveLength(1);
    // Verify the catalog entry is lightweight — no instructions field
    const entry = catalog[0] as unknown as Record<string, unknown>;
    expect(entry['instructions']).toBeUndefined();
    expect(entry['rawContent']).toBeUndefined();
  });

  it('includes conditionalPaths from frontmatter paths field', async () => {
    const skillsDir = path.join(tmpDir, '.salmonloop', 'skills');
    await createSkillTree(skillsDir, [
      { name: 'conditional-skill', description: 'Conditional', paths: ['src/**/*.ts', 'lib/**'] },
    ]);

    const loader = new SkillLoader({ repoRoot: tmpDir });
    const catalog = await loader.loadCatalog();

    expect(catalog).toHaveLength(1);
    expect(catalog[0].conditionalPaths).toEqual(['src/**/*.ts', 'lib/**']);
  });

  it('applies first-win conflict resolution for duplicate skill names', async () => {
    // Create skills in two different search paths
    const salmonloopDir = path.join(tmpDir, '.salmonloop', 'skills');
    const agentsDir = path.join(tmpDir, '.agents', 'skills');

    await createSkillTree(salmonloopDir, [
      { name: 'dup-skill', description: 'From salmonloop (higher priority)' },
    ]);
    await createSkillTree(agentsDir, [
      { name: 'dup-skill', description: 'From agents (lower priority)' },
    ]);

    const loader = new SkillLoader({ repoRoot: tmpDir });
    const catalog = await loader.loadCatalog();

    // Only one entry — the higher-priority one wins
    const dupEntries = catalog.filter(e => e.id === 'dup-skill');
    expect(dupEntries).toHaveLength(1);
    expect(dupEntries[0].description).toBe('From salmonloop (higher priority)');
  });

  it('skips invalid skills and continues loading others', async () => {
    const skillsDir = path.join(tmpDir, '.salmonloop', 'skills');
    const fs = await import('node:fs/promises');

    // Create a valid skill
    await createSkillTree(skillsDir, [
      { name: 'valid-skill', description: 'Valid' },
    ]);

    // Create an invalid skill (missing description)
    const invalidDir = path.join(skillsDir, 'bad-skill');
    await fs.mkdir(invalidDir, { recursive: true });
    await fs.writeFile(
      path.join(invalidDir, 'SKILL.md'),
      '---\nname: bad-skill\n---\nNo description.\n',
    );

    const loader = new SkillLoader({ repoRoot: tmpDir });
    const catalog = await loader.loadCatalog();

    // Only the valid skill should be loaded
    expect(catalog).toHaveLength(1);
    expect(catalog[0].id).toBe('valid-skill');
  });

  it('returns empty array when no skills exist', async () => {
    const loader = new SkillLoader({ repoRoot: tmpDir });
    const catalog = await loader.loadCatalog();
    expect(catalog).toEqual([]);
  });

  it('backward compat: initialize() still returns full Skill objects', async () => {
    const skillsDir = path.join(tmpDir, '.salmonloop', 'skills');
    await createSkillTree(skillsDir, [
      { name: 'full-skill', description: 'Full load test' },
    ]);

    const loader = new SkillLoader({ repoRoot: tmpDir });
    const skills = await loader.initialize();

    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe('full-skill');
    expect(skills[0].instructions).toBeDefined();
    expect(skills[0].rawContent).toBeDefined();
    expect(skills[0].metadata.name).toBe('full-skill');
  });
});
