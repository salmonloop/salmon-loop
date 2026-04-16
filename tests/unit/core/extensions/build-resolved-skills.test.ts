/**
 * Unit tests for buildResolvedSkills path trust boundary logic.
 *
 * Tests Property 5: Repo Path Containment — in-root allowed, out-of-root denied.
 * Also tests: absolute path rejected in repo scope, allowed in user scope.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 10.1, 10.2
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

// --- Mocks (must be declared before mock.module calls) ---

const auditMock = mock();
const isWithinRootMock = mock();
const loadConfigMock = mock();

mock.module('../../../../src/core/observability/logger.js', () => ({
  getLogger: () => ({
    audit: auditMock,
    debug: mock(),
    info: mock(),
    warn: mock(),
    error: mock(),
  }),
}));

mock.module('../../../../src/core/extensions/paths.js', () => ({
  expandHome: (value: string) => {
    if (value.startsWith('~')) {
      return '/mock-home' + value.slice(1);
    }
    return value;
  },
  resolveRepoRelative: (repoRoot: string, relative: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require('node:path');
    if (p.isAbsolute(relative)) return relative;
    return p.resolve(repoRoot, relative);
  },
  resolveUserRelative: (relative: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require('node:path');
    if (p.isAbsolute(relative)) return relative;
    return p.resolve('/mock-home/.salmonloop/config', relative);
  },
  isWithinRoot: isWithinRootMock,
  getRepoMcpConfigPath: (root: string) => root + '/.salmonloop/config/mcp.json',
  getRepoToolConfigPath: (root: string) => root + '/.salmonloop/config/tools.json',
  getRepoSkillConfigPath: (root: string) => root + '/.salmonloop/config/skills.json',
  getUserMcpConfigPath: () => '/mock-home/.salmonloop/config/mcp-user.json',
  getUserToolConfigPath: () => '/mock-home/.salmonloop/config/tools-user.json',
  getUserSkillConfigPath: () => '/mock-home/.salmonloop/config/skills-user.json',
  REPO_CONFIG_DIR: '.salmonloop/config',
  USER_CONFIG_DIR: '/mock-home/.salmonloop/config',
}));

mock.module('../../../../src/core/extensions/load.js', () => ({
  loadConfig: loadConfigMock,
  ExtensionConfigError: class ExtensionConfigError extends Error {
    constructor(
      public readonly path: string,
      message: string,
    ) {
      super(`Extension config ${path}: ${message}`);
      this.name = 'ExtensionConfigError';
    }
  },
}));

async function loadModule() {
  return await import('../../../../src/core/extensions/index.js');
}

describe('buildResolvedSkills — path trust boundary (unit)', () => {
  const REPO_ROOT = '/fake/repo';

  beforeEach(() => {
    auditMock.mockReset();
    isWithinRootMock.mockReset();
    loadConfigMock.mockReset();

    // Default: all config files return null (not found)
    loadConfigMock.mockResolvedValue(null);
  });

  /**
   * Helper: configure loadConfigMock to return specific skill configs.
   * loadConfig is called 6 times in resolveExtensions (mcp-user, mcp-repo, tools-user, tools-repo, skills-user, skills-repo).
   * Skills are at indices 4 (user) and 5 (repo).
   */
  function setupSkillConfigs(
    userSkills: { version: 1; discovery: { paths?: string[]; useDefaults?: boolean } } | null,
    repoSkills: { version: 1; discovery: { paths?: string[]; useDefaults?: boolean } } | null,
  ) {
    loadConfigMock.mockImplementation(async (path: string) => {
      if (
        path.includes('skills-user') ||
        (path.includes('skills.json') === false && path.includes('skills-user'))
      ) {
        return userSkills ? { path, config: userSkills } : null;
      }
      if (path.includes('skills.json')) {
        return repoSkills ? { path, config: repoSkills } : null;
      }
      return null;
    });
  }

  // --- Property 5: Repo Path Containment ---

  it('allows repo-scoped relative paths that resolve within root', async () => {
    const { resolveExtensions } = await loadModule();

    setupSkillConfigs(null, {
      version: 1,
      discovery: { paths: ['skills', 'custom/skills'] },
    });
    isWithinRootMock.mockReturnValue(true);

    const result = await resolveExtensions({ repoRoot: REPO_ROOT });

    expect(result.resolved.skillDiscovery.paths.length).toBe(2);
    expect(result.resolved.skillDiscovery.scope).toBe('repo');
  });

  it('rejects repo-scoped paths that resolve outside root', async () => {
    const { resolveExtensions } = await loadModule();

    setupSkillConfigs(null, {
      version: 1,
      discovery: { paths: ['../../../etc/passwd'] },
    });
    isWithinRootMock.mockReturnValue(false);

    const result = await resolveExtensions({ repoRoot: REPO_ROOT });

    expect(result.resolved.skillDiscovery.paths).toEqual([]);
    expect(auditMock).toHaveBeenCalledWith(
      'SKILL_PATH_REJECTED',
      expect.objectContaining({ reason: 'outside_repo_root' }),
      expect.objectContaining({ source: 'skill-loader', severity: 'high' }),
    );
  });

  it('emits audit event for each rejected path', async () => {
    const { resolveExtensions } = await loadModule();

    setupSkillConfigs(null, {
      version: 1,
      discovery: { paths: ['good', 'bad1', 'bad2'] },
    });
    isWithinRootMock.mockImplementation((p: string) => {
      return p.includes('good');
    });

    const result = await resolveExtensions({ repoRoot: REPO_ROOT });

    // Only the "good" path should survive
    expect(result.resolved.skillDiscovery.paths.length).toBe(1);
    // Two audit events for the two rejected paths
    const auditCalls = auditMock.mock.calls.filter(
      (c: unknown[]) =>
        c[0] === 'SKILL_PATH_REJECTED' &&
        (c[1] as { reason: string }).reason === 'outside_repo_root',
    );
    expect(auditCalls.length).toBe(2);
  });

  // --- Absolute path rejection in repo scope ---

  it('rejects absolute paths in repo scope', async () => {
    const { resolveExtensions } = await loadModule();

    setupSkillConfigs(null, {
      version: 1,
      discovery: { paths: ['/etc/malicious', 'valid-relative'] },
    });
    isWithinRootMock.mockReturnValue(true);

    const result = await resolveExtensions({ repoRoot: REPO_ROOT });

    // Only the relative path should survive (absolute rejected before isWithinRoot check)
    expect(result.resolved.skillDiscovery.paths.length).toBe(1);
    expect(auditMock).toHaveBeenCalledWith(
      'SKILL_PATH_REJECTED',
      expect.objectContaining({ reason: 'absolute_path_in_repo_scope' }),
      expect.objectContaining({ source: 'skill-loader', severity: 'high' }),
    );
  });

  // --- Absolute path allowed in user scope ---

  it('allows absolute paths in user scope', async () => {
    const { resolveExtensions } = await loadModule();

    setupSkillConfigs(
      {
        version: 1,
        discovery: { paths: ['/home/user/my-skills'] },
      },
      null,
    );
    // isWithinRoot should NOT be called for user-scope paths
    isWithinRootMock.mockReturnValue(false);

    const result = await resolveExtensions({ repoRoot: REPO_ROOT });

    expect(result.resolved.skillDiscovery.scope).toBe('user');
    expect(result.resolved.skillDiscovery.paths.length).toBe(1);
    // No audit events for user-scope absolute paths
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('does not call isWithinRoot for user-scoped paths', async () => {
    const { resolveExtensions } = await loadModule();

    setupSkillConfigs(
      {
        version: 1,
        discovery: { paths: ['my-skills', '~/other-skills'] },
      },
      null,
    );

    const result = await resolveExtensions({ repoRoot: REPO_ROOT });

    expect(result.resolved.skillDiscovery.scope).toBe('user');
    expect(isWithinRootMock).not.toHaveBeenCalled();
  });
});
