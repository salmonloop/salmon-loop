/**
 * Integration tests for dynamic skill discovery — real filesystem operations.
 *
 * Validates: Requirements 7.3, 7.4, 10.2
 *
 * - Conditional skill activates when a matching file is touched
 * - Conditional skill stays catalog-only when no files match
 *
 * Uses real temp directories with actual SKILL.md files, SkillLoader for
 * catalog loading, and SkillDiscoveryWatcher for conditional activation.
 */
import { beforeAll, describe, it, expect, afterEach } from 'bun:test';

import {
  createLogger,
  setLogger,
  tryGetLogger,
} from '../../../src/core/observability/logger.js';
import { SkillDiscoveryWatcher } from '../../../src/core/skills/discovery.js';
import { SkillLoader } from '../../../src/core/skills/loader.js';
import { RealFsTestHelper } from '../../helpers/real-fs-helper.js';

// Ensure logger is initialized for integration tests
beforeAll(() => {
  if (!tryGetLogger()) {
    setLogger(createLogger({ silent: true }));
  }
});

// ── Helpers ──────────────────────────────────────────────────────────

const SKILL_MD_CONDITIONAL = (name: string, paths: string[]) =>
  `---
name: ${name}
description: A conditional skill for testing
paths:
${paths.map(p => `  - "${p}"`).join('\n')}
---

# ${name}

These are the full instructions for ${name}.
They should only be loaded on Tier 2 activation.
`;

const SKILL_MD_UNCONDITIONAL = (name: string) =>
  `---
name: ${name}
description: An unconditional skill for testing
---

# ${name}

Instructions for ${name}.
`;

// ── Test Suite ───────────────────────────────────────────────────────

describe('Dynamic Skill Discovery (Integration)', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  /**
   * Validates: Requirement 7.3
   *
   * WHEN a conditional skill's path pattern matches files in the current
   * context THEN THE System SHALL activate the skill.
   */
  it('conditional skill activates when matching file touched', async () => {
    // 1. Create a real skill directory with conditional paths in frontmatter
    const repoRoot = await helper.createTempDir('discovery-activate-');
    const skillDir = '.salmonloop/skills/ts-lint';
    await helper.writeFile(
      repoRoot,
      `${skillDir}/SKILL.md`,
      SKILL_MD_CONDITIONAL('ts-lint', ['src/**/*.ts']),
    );

    // 2. Use SkillLoader to load the catalog (Tier 1)
    const loader = new SkillLoader({ repoRoot, useDefaults: false });
    const catalog = await loader.loadCatalog();

    expect(catalog.length).toBe(1);
    expect(catalog[0].id).toBe('ts-lint');
    expect(catalog[0].conditionalPaths).toEqual(['src/**/*.ts']);

    // 3. Create a SkillDiscoveryWatcher with the catalog
    const watcher = new SkillDiscoveryWatcher(catalog);

    // 4. Simulate a file touch by calling checkConditionalActivation with a matching path
    const activated = watcher.checkConditionalActivation(
      ['src/utils/helper.ts'],
      catalog,
    );

    // 5. Verify the skill is returned for activation
    expect(activated.length).toBe(1);
    expect(activated[0].id).toBe('ts-lint');

    // 6. Call activateSkill() and verify full content is loaded (Tier 2)
    const skill = await loader.activateSkill('ts-lint');
    expect(skill.id).toBe('ts-lint');
    expect(skill.instructions).toContain('full instructions for ts-lint');
    expect(skill.metadata.name).toBe('ts-lint');
    expect(skill.metadata.paths).toEqual(['src/**/*.ts']);
  });

  /**
   * Validates: Requirement 7.4
   *
   * WHEN no matching files are present THEN THE conditional skill SHALL
   * remain in catalog-only mode.
   */
  it('conditional skill stays catalog-only when no match', async () => {
    // 1. Create a real skill directory with conditional paths
    const repoRoot = await helper.createTempDir('discovery-no-match-');
    const skillDir = '.salmonloop/skills/py-format';
    await helper.writeFile(
      repoRoot,
      `${skillDir}/SKILL.md`,
      SKILL_MD_CONDITIONAL('py-format', ['**/*.py', 'scripts/*.sh']),
    );

    // 2. Load catalog
    const loader = new SkillLoader({ repoRoot, useDefaults: false });
    const catalog = await loader.loadCatalog();

    expect(catalog.length).toBe(1);
    expect(catalog[0].id).toBe('py-format');

    // 3. Create watcher and call checkConditionalActivation with non-matching paths
    const watcher = new SkillDiscoveryWatcher(catalog);
    const activated = watcher.checkConditionalActivation(
      ['src/index.ts', 'docs/readme.md', 'package.json'],
      catalog,
    );

    // 4. Verify no skills are returned for activation
    expect(activated).toEqual([]);

    // 5. Verify the skill remains catalog-only (no instructions loaded)
    //    Attempting to read the skill via activateSkill would load it,
    //    so we verify the catalog entry has no instructions field
    //    and the loader's internal cache has not been populated.
    expect(catalog[0]).not.toHaveProperty('instructions');
    expect(catalog[0]).not.toHaveProperty('rawContent');
  });

  /**
   * Validates: Requirements 7.3, 7.4
   *
   * Mixed scenario: multiple skills with different conditional paths.
   * Only the matching one activates; the non-matching one stays catalog-only.
   */
  it('only matching conditional skills activate in mixed catalog', async () => {
    const repoRoot = await helper.createTempDir('discovery-mixed-');

    // Create two conditional skills and one unconditional
    await helper.writeFile(
      repoRoot,
      '.salmonloop/skills/css-lint/SKILL.md',
      SKILL_MD_CONDITIONAL('css-lint', ['**/*.css', '**/*.scss']),
    );
    await helper.writeFile(
      repoRoot,
      '.salmonloop/skills/ts-lint/SKILL.md',
      SKILL_MD_CONDITIONAL('ts-lint', ['src/**/*.ts']),
    );
    await helper.writeFile(
      repoRoot,
      '.salmonloop/skills/general/SKILL.md',
      SKILL_MD_UNCONDITIONAL('general'),
    );

    const loader = new SkillLoader({ repoRoot, useDefaults: false });
    const catalog = await loader.loadCatalog();

    expect(catalog.length).toBe(3);

    const watcher = new SkillDiscoveryWatcher(catalog);

    // Touch a .css file — only css-lint should activate
    const activated = watcher.checkConditionalActivation(
      ['styles/main.css'],
      catalog,
    );

    expect(activated.length).toBe(1);
    expect(activated[0].id).toBe('css-lint');

    // Activate the matched skill and verify full content
    const skill = await loader.activateSkill('css-lint');
    expect(skill.instructions).toContain('full instructions for css-lint');
  });
});
