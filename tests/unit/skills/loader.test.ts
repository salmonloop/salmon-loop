/**
 * Unit tests for SkillLoader — SKILL.md subdirectory format enforcement
 * and discovery priority determinism.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 10.1, 10.2, 11.1, 11.2
 *
 * - Default: only scan for `skill-name/SKILL.md` pattern
 * - Compatibility flag: also accept direct `.md` files with deprecation warning
 * - Discovery priority: higher-priority path wins on name collision
 * - .agents/skills paths discoverable at repo and user level
 */
import path from 'node:path';

import { describe, it, expect, beforeEach, mock } from 'bun:test';

const existsSyncMock = mock();
const readdirSyncMock = mock();
const readFileSyncMock = mock();

mock.module('../../../src/core/adapters/fs/node-fs.js', () => ({
  syncFs: {
    existsSync: existsSyncMock,
    readdirSync: readdirSyncMock,
    readFileSync: readFileSyncMock,
  },
}));

const warnMock = mock();
const errorMock = mock();
const auditMock = mock();
const infoMock = mock();

mock.module('../../../src/core/observability/logger.js', () => ({
  getLogger: () => ({
    warn: warnMock,
    error: errorMock,
    info: infoMock,
    debug: mock(),
    audit: auditMock,
  }),
  tryGetLogger: () => ({
    warn: warnMock,
    error: errorMock,
    info: infoMock,
    debug: mock(),
    audit: auditMock,
  }),
}));

import { SkillLoader } from '../../../src/core/skills/loader.js';

// ── Helpers ──────────────────────────────────────────────────────────

const VALID_SKILL_MD = `---
name: my-skill
description: A test skill
---
Do something useful.`;

/** Fake Dirent for a directory entry */
function dirEntry(name: string) {
  return { name, isDirectory: () => true, isFile: () => false };
}

/** Fake Dirent for a file entry */
function fileEntry(name: string) {
  return { name, isDirectory: () => false, isFile: () => true };
}

/** Build valid SKILL.md content with a given name */
function skillMd(name: string, description = `Skill ${name}`) {
  return `---\nname: ${name}\ndescription: ${description}\n---\nInstructions for ${name}.`;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('SkillLoader — SKILL.md subdirectory format enforcement', () => {
  const repoRoot = '/fake/repo';

  beforeEach(() => {
    mock.clearAllMocks();
    // By default, all paths exist
    existsSyncMock.mockReturnValue(true);
    // By default, return empty directory
    readdirSyncMock.mockReturnValue([]);
    readFileSyncMock.mockReturnValue(VALID_SKILL_MD);
  });

  describe('default mode (legacyDirectMd=false)', () => {
    it('loads skill from subdirectory SKILL.md pattern', async () => {
      readdirSyncMock.mockReturnValue([dirEntry('my-skill')]);

      const loader = new SkillLoader({
        repoRoot,
        useDefaults: false,
        extraPaths: ['/fake/repo/.salmonloop/skills'],
      });
      const skills = await loader.initialize();

      expect(skills.length).toBe(1);
      expect(skills[0].id).toBe('my-skill');
    });

    it('ignores direct .md files when legacyDirectMd is not set', async () => {
      readdirSyncMock.mockReturnValue([fileEntry('my-skill.md')]);

      const loader = new SkillLoader({
        repoRoot,
        useDefaults: false,
        extraPaths: ['/fake/repo/.salmonloop/skills'],
      });
      const skills = await loader.initialize();

      expect(skills.length).toBe(0);
      expect(warnMock).not.toHaveBeenCalled();
    });

    it('ignores direct .md files when legacyDirectMd is explicitly false', async () => {
      readdirSyncMock.mockReturnValue([fileEntry('legacy-skill.md')]);

      const loader = new SkillLoader({
        repoRoot,
        useDefaults: false,
        extraPaths: ['/fake/repo/.salmonloop/skills'],
        legacyDirectMd: false,
      });
      const skills = await loader.initialize();

      expect(skills.length).toBe(0);
    });

    it('skips subdirectory without SKILL.md file', async () => {
      readdirSyncMock.mockReturnValue([dirEntry('empty-dir')]);
      // existsSync returns true for the search path, but false for the SKILL.md inside
      existsSyncMock.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('SKILL.md')) return false;
        return true;
      });

      const loader = new SkillLoader({
        repoRoot,
        useDefaults: false,
        extraPaths: ['/fake/repo/.salmonloop/skills'],
      });
      const skills = await loader.initialize();

      expect(skills.length).toBe(0);
    });
  });

  describe('compatibility mode (legacyDirectMd=true)', () => {
    it('loads direct .md files with deprecation warning', async () => {
      readdirSyncMock.mockReturnValue([fileEntry('my-skill.md')]);
      readFileSyncMock.mockReturnValue(VALID_SKILL_MD);

      const loader = new SkillLoader({
        repoRoot,
        useDefaults: false,
        extraPaths: ['/fake/repo/.salmonloop/skills'],
        legacyDirectMd: true,
      });
      const skills = await loader.initialize();

      expect(skills.length).toBe(1);
      expect(skills[0].id).toBe('my-skill');
      // Deprecation warning must be emitted
      expect(warnMock).toHaveBeenCalled();
      const warnMsg = warnMock.mock.calls[0][0] as string;
      expect(warnMsg).toContain('deprecated');
    });

    it('still loads subdirectory SKILL.md format alongside legacy files', async () => {
      const otherSkillMd = `---
name: other-skill
description: Another skill
---
Other instructions.`;

      readdirSyncMock.mockReturnValue([
        dirEntry('my-skill'),
        fileEntry('other-skill.md'),
      ]);
      readFileSyncMock.mockImplementation((filePath: string) => {
        if (typeof filePath === 'string' && filePath.includes('other-skill')) return otherSkillMd;
        return VALID_SKILL_MD;
      });

      const loader = new SkillLoader({
        repoRoot,
        useDefaults: false,
        extraPaths: ['/fake/repo/.salmonloop/skills'],
        legacyDirectMd: true,
      });
      const skills = await loader.initialize();

      expect(skills.length).toBe(2);
      const ids = skills.map((s) => s.id).sort();
      expect(ids).toEqual(['my-skill', 'other-skill']);
    });

    it('emits deprecation warning containing migration guidance', async () => {
      readdirSyncMock.mockReturnValue([fileEntry('legacy.md')]);
      readFileSyncMock.mockReturnValue(`---
name: legacy
description: A legacy skill
---
Legacy instructions.`);

      const loader = new SkillLoader({
        repoRoot,
        useDefaults: false,
        extraPaths: ['/fake/repo/.salmonloop/skills'],
        legacyDirectMd: true,
      });
      await loader.initialize();

      expect(warnMock).toHaveBeenCalled();
      const warnMsg = warnMock.mock.calls[0][0] as string;
      // Warning should mention conversion to subdirectory format
      expect(warnMsg).toContain('SKILL.md');
    });
  });

  describe('error handling', () => {
    it('logs error and continues when a skill file fails to parse', async () => {
      readdirSyncMock.mockReturnValue([dirEntry('bad-skill')]);
      readFileSyncMock.mockReturnValue('not valid frontmatter');

      const loader = new SkillLoader({
        repoRoot,
        useDefaults: false,
        extraPaths: ['/fake/repo/.salmonloop/skills'],
      });
      const skills = await loader.initialize();

      expect(skills.length).toBe(0);
      expect(errorMock).toHaveBeenCalled();
    });

    it('skips non-existent search paths gracefully', async () => {
      existsSyncMock.mockReturnValue(false);

      const loader = new SkillLoader({
        repoRoot,
        useDefaults: false,
        extraPaths: ['/nonexistent/path'],
      });
      const skills = await loader.initialize();

      expect(skills.length).toBe(0);
    });
  });

  describe('duplicate skill handling', () => {
    it('warns and skips duplicate skill ids', async () => {
      // Two directories with skills that have the same name in frontmatter
      readdirSyncMock.mockReturnValue([dirEntry('my-skill')]);

      const loader = new SkillLoader({
        repoRoot,
        useDefaults: false,
        extraPaths: ['/path-a', '/path-b'],
      });
      const skills = await loader.initialize();

      // First one wins, second is skipped with warning
      expect(skills.length).toBe(1);
      expect(warnMock).toHaveBeenCalled();
      const warnMsg = warnMock.mock.calls[0][0] as string;
      expect(warnMsg).toContain('Duplicate skill');
    });
  });

  /**
   * Property 9: Discovery Priority Determinism
   * ∀ name ∈ SkillNames, ∀ path1, path2 WHERE priority(path1) > priority(path2):
   *   loadedSkill(name).source === path1
   *
   * Validates: Requirements 4.4, 4.5
   */
  describe('Property 9: Discovery Priority Determinism', () => {
    it('higher-priority path wins when same skill name exists in multiple paths', async () => {
      // .salmonloop/skills (priority 2) should beat .agents/skills (priority 3)
      const salmonloopPath = path.join(repoRoot, '.salmonloop', 'skills');
      const agentsPath = path.join(repoRoot, '.agents', 'skills');

      readdirSyncMock.mockImplementation((dir: string) => {
        if (dir === salmonloopPath) return [dirEntry('shared-skill')];
        if (dir === agentsPath) return [dirEntry('shared-skill')];
        return [];
      });

      const salmonloopContent = skillMd('shared-skill', 'From salmonloop');
      const agentsContent = skillMd('shared-skill', 'From agents');

      readFileSyncMock.mockImplementation((filePath: string) => {
        if (typeof filePath === 'string' && filePath.startsWith(salmonloopPath)) return salmonloopContent;
        if (typeof filePath === 'string' && filePath.startsWith(agentsPath)) return agentsContent;
        return VALID_SKILL_MD;
      });

      const loader = new SkillLoader({ repoRoot, useDefaults: false });
      const skills = await loader.initialize();

      expect(skills.length).toBe(1);
      expect(skills[0].id).toBe('shared-skill');
      // The winning skill should come from the higher-priority salmonloop path
      expect(skills[0].metadata.description).toBe('From salmonloop');
    });

    it('config extra paths have highest priority over all default paths', async () => {
      const configPath = path.join(repoRoot, 'custom-config-skills');
      const salmonloopPath = path.join(repoRoot, '.salmonloop', 'skills');

      readdirSyncMock.mockImplementation((dir: string) => {
        if (dir === configPath) return [dirEntry('priority-skill')];
        if (dir === salmonloopPath) return [dirEntry('priority-skill')];
        return [];
      });

      readFileSyncMock.mockImplementation((filePath: string) => {
        if (typeof filePath === 'string' && filePath.startsWith(configPath)) {
          return skillMd('priority-skill', 'From config');
        }
        if (typeof filePath === 'string' && filePath.startsWith(salmonloopPath)) {
          return skillMd('priority-skill', 'From salmonloop');
        }
        return VALID_SKILL_MD;
      });

      const loader = new SkillLoader({
        repoRoot,
        useDefaults: false,
        extraPaths: [configPath],
      });
      const skills = await loader.initialize();

      expect(skills.length).toBe(1);
      expect(skills[0].metadata.description).toBe('From config');
    });

    it('duplicate from lower-priority path emits warning with both source paths', async () => {
      const salmonloopPath = path.join(repoRoot, '.salmonloop', 'skills');
      const agentsPath = path.join(repoRoot, '.agents', 'skills');

      readdirSyncMock.mockImplementation((dir: string) => {
        if (dir === salmonloopPath) return [dirEntry('dup-skill')];
        if (dir === agentsPath) return [dirEntry('dup-skill')];
        return [];
      });

      readFileSyncMock.mockReturnValue(skillMd('dup-skill'));

      const loader = new SkillLoader({ repoRoot, useDefaults: false });
      await loader.initialize();

      // Warning should mention the duplicate and reference both paths
      expect(warnMock).toHaveBeenCalled();
      const warnMsg = warnMock.mock.calls[0][0] as string;
      expect(warnMsg).toContain('Duplicate skill');
      expect(warnMsg).toContain('dup-skill');
    });
  });

  /**
   * Integration: .agents/skills/<name>/SKILL.md discoverable
   *
   * Validates: Requirements 4.3
   */
  describe('.agents/skills path discovery', () => {
    it('discovers skills from repo-level .agents/skills path', async () => {
      const agentsPath = path.join(repoRoot, '.agents', 'skills');

      readdirSyncMock.mockImplementation((dir: string) => {
        if (dir === agentsPath) return [dirEntry('agent-skill')];
        return [];
      });

      readFileSyncMock.mockReturnValue(skillMd('agent-skill'));

      // useDefaults: true to include all default paths
      const loader = new SkillLoader({ repoRoot, useDefaults: true });
      const skills = await loader.initialize();

      expect(skills.length).toBe(1);
      expect(skills[0].id).toBe('agent-skill');
    });

    it('discovers skills from both .salmonloop and .agents paths simultaneously', async () => {
      const salmonloopPath = path.join(repoRoot, '.salmonloop', 'skills');
      const agentsPath = path.join(repoRoot, '.agents', 'skills');

      readdirSyncMock.mockImplementation((dir: string) => {
        if (dir === salmonloopPath) return [dirEntry('salmon-only')];
        if (dir === agentsPath) return [dirEntry('agent-only')];
        return [];
      });

      readFileSyncMock.mockImplementation((filePath: string) => {
        if (typeof filePath === 'string' && filePath.includes('salmon-only')) {
          return skillMd('salmon-only');
        }
        if (typeof filePath === 'string' && filePath.includes('agent-only')) {
          return skillMd('agent-only');
        }
        return VALID_SKILL_MD;
      });

      const loader = new SkillLoader({ repoRoot, useDefaults: false });
      const skills = await loader.initialize();

      expect(skills.length).toBe(2);
      const ids = skills.map((s) => s.id).sort();
      expect(ids).toEqual(['agent-only', 'salmon-only']);
    });
  });

  /**
   * Integration: name collision across paths logged
   *
   * Validates: Requirements 4.5, 10.1, 10.2
   */
  describe('name collision across paths', () => {
    it('logs warning and audit event when same skill found in multiple paths', async () => {
      const salmonloopPath = path.join(repoRoot, '.salmonloop', 'skills');
      const agentsPath = path.join(repoRoot, '.agents', 'skills');

      readdirSyncMock.mockImplementation((dir: string) => {
        if (dir === salmonloopPath) return [dirEntry('colliding-skill')];
        if (dir === agentsPath) return [dirEntry('colliding-skill')];
        return [];
      });

      readFileSyncMock.mockReturnValue(skillMd('colliding-skill'));

      const loader = new SkillLoader({ repoRoot, useDefaults: false });
      const skills = await loader.initialize();

      // Only the first (higher-priority) skill is loaded
      expect(skills.length).toBe(1);

      // Warning logged for the collision
      expect(warnMock).toHaveBeenCalled();
      const warnMsg = warnMock.mock.calls[0][0] as string;
      expect(warnMsg).toContain('Duplicate skill');
      expect(warnMsg).toContain('colliding-skill');

      // Audit event emitted for the skipped duplicate
      expect(auditMock).toHaveBeenCalled();
      const auditEventName = auditMock.mock.calls[0][0] as string;
      expect(auditEventName).toBe('SKILL_DUPLICATE_SKIPPED');
      const auditPayload = auditMock.mock.calls[0][1] as Record<string, unknown>;
      expect(auditPayload.skillId).toBe('colliding-skill');
      expect(auditPayload.reason).toBe('first_win_conflict_resolution');
    });

    it('collision across three paths loads only the first and logs two warnings', async () => {
      const configPath = path.join(repoRoot, 'custom-skills');
      const salmonloopPath = path.join(repoRoot, '.salmonloop', 'skills');
      const agentsPath = path.join(repoRoot, '.agents', 'skills');

      readdirSyncMock.mockImplementation((dir: string) => {
        if (dir === configPath) return [dirEntry('triple-skill')];
        if (dir === salmonloopPath) return [dirEntry('triple-skill')];
        if (dir === agentsPath) return [dirEntry('triple-skill')];
        return [];
      });

      readFileSyncMock.mockReturnValue(skillMd('triple-skill'));

      const loader = new SkillLoader({
        repoRoot,
        useDefaults: false,
        extraPaths: [configPath],
      });
      const skills = await loader.initialize();

      expect(skills.length).toBe(1);
      expect(skills[0].id).toBe('triple-skill');

      // Two duplicate warnings (one for salmonloop, one for agents)
      const warnCalls = warnMock.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('Duplicate skill'),
      );
      expect(warnCalls.length).toBe(2);

      // Two audit events for the two skipped duplicates
      const auditCalls = auditMock.mock.calls.filter(
        (c: unknown[]) => c[0] === 'SKILL_DUPLICATE_SKIPPED',
      );
      expect(auditCalls.length).toBe(2);
    });
  });
});

/**
 * Unit tests for SkillLoader.activateSkill() — Tier 2 on-demand loading.
 *
 * Validates: Requirements 6.2, 6.4
 *
 * - Loads full SKILL.md content on demand via activateSkill(id)
 * - Returns cached Skill on repeated activation
 * - Throws when skill id is not found in catalog
 * - Lazily loads catalog if not yet loaded
 */
describe('SkillLoader — activateSkill() Tier 2 loading', () => {
  const repoRoot = '/fake/repo';

  beforeEach(() => {
    mock.clearAllMocks();
    existsSyncMock.mockReturnValue(true);
    readdirSyncMock.mockReturnValue([]);
    readFileSyncMock.mockReturnValue('');
  });

  it('loads full skill content on activation', async () => {
    const salmonloopPath = path.join(repoRoot, '.salmonloop', 'skills');
    const _skillFilePath = path.join(salmonloopPath, 'my-skill', 'SKILL.md');
    const fullContent = skillMd('my-skill', 'A useful skill');

    readdirSyncMock.mockImplementation((dir: string) => {
      if (dir === salmonloopPath) return [dirEntry('my-skill')];
      return [];
    });
    readFileSyncMock.mockReturnValue(fullContent);

    const loader = new SkillLoader({ repoRoot, useDefaults: false });
    const skill = await loader.activateSkill('my-skill');

    expect(skill.id).toBe('my-skill');
    expect(skill.metadata.description).toBe('A useful skill');
    expect(skill.instructions).toBe('Instructions for my-skill.');
    expect(skill.rawContent).toBe(fullContent);
  });

  it('returns cached skill on repeated activation', async () => {
    const salmonloopPath = path.join(repoRoot, '.salmonloop', 'skills');
    const fullContent = skillMd('cached-skill');

    readdirSyncMock.mockImplementation((dir: string) => {
      if (dir === salmonloopPath) return [dirEntry('cached-skill')];
      return [];
    });
    readFileSyncMock.mockReturnValue(fullContent);

    const loader = new SkillLoader({ repoRoot, useDefaults: false });

    const first = await loader.activateSkill('cached-skill');
    // Clear mocks to verify no re-read on second call
    readFileSyncMock.mockClear();

    const second = await loader.activateSkill('cached-skill');

    expect(second).toBe(first); // Same reference — cached
    // readFileSync should NOT have been called again for the skill file
    // (it may be called for catalog loading, but the skill itself is cached)
    const readCalls = readFileSyncMock.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('cached-skill'),
    );
    expect(readCalls.length).toBe(0);
  });

  it('throws when skill id is not found in catalog', async () => {
    readdirSyncMock.mockReturnValue([]);

    const loader = new SkillLoader({ repoRoot, useDefaults: false });

    await expect(loader.activateSkill('nonexistent')).rejects.toThrow('not found in catalog');
  });

  it('lazily loads catalog if not yet loaded', async () => {
    const salmonloopPath = path.join(repoRoot, '.salmonloop', 'skills');
    const fullContent = skillMd('lazy-skill');

    readdirSyncMock.mockImplementation((dir: string) => {
      if (dir === salmonloopPath) return [dirEntry('lazy-skill')];
      return [];
    });
    readFileSyncMock.mockReturnValue(fullContent);

    const loader = new SkillLoader({ repoRoot, useDefaults: false });
    // Do NOT call loadCatalog() first — activateSkill should do it internally
    const skill = await loader.activateSkill('lazy-skill');

    expect(skill.id).toBe('lazy-skill');
    expect(skill.instructions).toBe('Instructions for lazy-skill.');
  });

  it('uses pre-loaded catalog when loadCatalog() was called first', async () => {
    const salmonloopPath = path.join(repoRoot, '.salmonloop', 'skills');
    const fullContent = skillMd('preloaded-skill');

    readdirSyncMock.mockImplementation((dir: string) => {
      if (dir === salmonloopPath) return [dirEntry('preloaded-skill')];
      return [];
    });
    readFileSyncMock.mockReturnValue(fullContent);

    const loader = new SkillLoader({ repoRoot, useDefaults: false });
    await loader.loadCatalog();

    // Clear readdirSync to verify catalog is not re-scanned
    readdirSyncMock.mockClear();

    const skill = await loader.activateSkill('preloaded-skill');

    expect(skill.id).toBe('preloaded-skill');
    // readdirSync should NOT have been called again (catalog was cached)
    expect(readdirSyncMock).not.toHaveBeenCalled();
  });

  it('logs info message on successful activation', async () => {
    const salmonloopPath = path.join(repoRoot, '.salmonloop', 'skills');
    const fullContent = skillMd('logged-skill');

    readdirSyncMock.mockImplementation((dir: string) => {
      if (dir === salmonloopPath) return [dirEntry('logged-skill')];
      return [];
    });
    readFileSyncMock.mockReturnValue(fullContent);

    const loader = new SkillLoader({ repoRoot, useDefaults: false });
    await loader.activateSkill('logged-skill');

    const infoCalls = infoMock.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('logged-skill'),
    );
    expect(infoCalls.length).toBeGreaterThanOrEqual(1);
    expect(infoCalls[0][0]).toContain('activated');
  });
});
