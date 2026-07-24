import * as crypto from 'crypto';
import * as os from 'os';

import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { defaultPathAdapter } from '../../../../src/core/adapters/path/path-adapter.js';
import type { ToolAuthorizationConfig } from '../../../../src/core/config/types.js';
import { setLogger } from '../../../../src/core/observability/logger.js';
import { Phase } from '../../../../src/core/types/index.js';

const files = new Map<string, string>();
const mtimes = new Map<string, number>();

function setFile(path: string, content: string) {
  files.set(path, content);
  const next = (mtimes.get(path) ?? 0) + 1;
  mtimes.set(path, next);
}

function removeFile(path: string) {
  files.delete(path);
  mtimes.delete(path);
}

mock.module('fs/promises', () => ({
  readFile: mock(async (filePath: string) => {
    if (!files.has(filePath)) {
      const error: any = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      throw error;
    }
    return files.get(filePath) as string;
  }),
  readdir: mock(async () => []),
  copyFile: mock(async (from: string, to: string) => {
    if (!files.has(from)) {
      const error: any = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      throw error;
    }
    const content = files.get(from) as string;
    files.set(to, content);
    mtimes.set(to, (mtimes.get(from) ?? 1) + 1);
  }),
  realpath: mock(async (filePath: string) => {
    // Always return the path itself for test paths
    return filePath;
  }),
  writeFile: mock(async (filePath: string, data: string | Buffer) => {
    const content = typeof data === 'string' ? data : data.toString();
    setFile(filePath, content);
  }),
  lstat: mock(async (filePath: string) => {
    if (!files.has(filePath)) {
      const error: any = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      throw error;
    }
    return { isSymbolicLink: () => false } as any;
  }),
  open: mock(async (filePath: string, flags?: string) => {
    if (flags === 'wx' && files.has(filePath)) {
      const error: any = new Error('EEXIST: file already exists');
      error.code = 'EEXIST';
      throw error;
    }
    if (!files.has(filePath)) {
      setFile(filePath, '');
    }
    return {
      writeFile: async (content: string | Buffer) => {
        const value = typeof content === 'string' ? content : content.toString();
        setFile(filePath, value);
      },
      close: async () => undefined,
    };
  }),
  mkdir: mock(async () => undefined),
  stat: mock(async (filePath: string) => {
    if (!files.has(filePath)) {
      const error: any = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      throw error;
    }
    const content = files.get(filePath) ?? '';
    return { mtimeMs: mtimes.get(filePath) ?? 1, size: content.length } as any;
  }),
  rename: mock(async (from: string, to: string) => {
    if (!files.has(from)) {
      const error: any = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      throw error;
    }
    const content = files.get(from) as string;
    files.set(to, content);
    files.delete(from);
  }),
  unlink: mock(async (filePath: string) => {
    if (!files.has(filePath)) {
      const error: any = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      throw error;
    }
    removeFile(filePath);
  }),
}));

mock.module('../../../../src/cli/utils/safe-fs.js', () => ({
  readFileUtf8: mock(async (filePath: string) => {
    if (!files.has(filePath)) {
      const error: any = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      throw error;
    }
    return files.get(filePath) as string;
  }),
  writeFileUtf8: mock(async (filePath: string, data: string) => {
    setFile(filePath, data);
  }),
  stat: mock(async (filePath: string) => {
    if (!files.has(filePath)) {
      const error: any = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      throw error;
    }
    const content = files.get(filePath) ?? '';
    return { mtimeMs: mtimes.get(filePath) ?? 1, size: content.length } as any;
  }),
  readdir: mock(async () => []),
  copyFile: mock(async (from: string, to: string) => {
    if (!files.has(from)) {
      const error: any = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      throw error;
    }
    const content = files.get(from) as string;
    files.set(to, content);
    mtimes.set(to, (mtimes.get(from) ?? 1) + 1);
  }),
  realpath: mock(async (filePath: string) => {
    // Always return the path itself for test paths
    return filePath;
  }),
  rename: mock(async (from: string, to: string) => {
    if (!files.has(from)) {
      const error: any = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      throw error;
    }
    const content = files.get(from) as string;
    files.set(to, content);
    files.delete(from);
  }),
  unlink: mock(async (filePath: string) => {
    if (!files.has(filePath)) {
      const error: any = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      throw error;
    }
    removeFile(filePath);
  }),
  openFile: mock(async (filePath: string, flags?: string) => {
    if (flags === 'wx' && files.has(filePath)) {
      const error: any = new Error('EEXIST: file already exists');
      error.code = 'EEXIST';
      throw error;
    }
    if (!files.has(filePath)) {
      setFile(filePath, '');
    }
    return {
      writeFile: async (content: string | Buffer) => {
        const value = typeof content === 'string' ? content : content.toString();
        setFile(filePath, value);
      },
      close: async () => undefined,
    };
  }),
  mkdirp: mock(async () => undefined),
}));

async function loadAllowlistModule() {
  return await import('../../../../src/cli/authorization/allowlist.js');
}

// normalize roots using defaultPathAdapter.resolve to ensure consistent separators on Windows
const repoRoot = defaultPathAdapter.resolve('/repo');
const repoAllowlistPath = defaultPathAdapter.resolve(
  repoRoot,
  '.salmonloop',
  'config',
  'authorization.json',
);
const userAllowlistPath = defaultPathAdapter.resolve(
  os.homedir(),
  '.salmonloop',
  'config',
  'authorization-user.json',
);
const cachePath = defaultPathAdapter.resolve(
  repoRoot,
  '.salmonloop',
  'state',
  `allowlist-cache-${crypto.createHash('sha256').update(repoAllowlistPath).digest('hex')}.json`,
);

const baseConfig: ToolAuthorizationConfig = {
  sessionTtlMs: 1000,
  autoAllowRisk: { low: true, medium: false, high: false },
  allowlist: {
    repoFile: '.salmonloop/config/authorization.json',
    userFile: '.salmonloop/config/authorization-user.json',
  },
};

describe('allowlist', () => {
  beforeEach(() => {
    files.clear();
    mtimes.clear();
    mock.restore();
    setLogger({
      error: mock(),
      warn: mock(),
      info: mock(),
      success: mock(),
      debug: mock(),
      trace: mock(),
      audit: mock(),
      setReporter: mock(),
    } as any);
  });

  it('prefers repo deny over user allow', async () => {
    const { loadAllowlistDecision } = await loadAllowlistModule();

    // Ensure parent directories exist
    files.set(defaultPathAdapter.resolve(repoRoot, '.salmonloop'), '');
    files.set(defaultPathAdapter.resolve(repoRoot, '.salmonloop', 'config'), '');
    files.set(defaultPathAdapter.resolve(os.homedir(), '.salmonloop'), '');
    files.set(defaultPathAdapter.resolve(os.homedir(), '.salmonloop', 'config'), '');

    setFile(
      repoAllowlistPath,
      JSON.stringify({
        version: 1,
        tools: {
          'net.request': {
            rules: [{ mode: 'deny', phase: 'CONTEXT' }],
          },
        },
      }),
    );

    setFile(
      userAllowlistPath,
      JSON.stringify({
        version: 1,
        tools: {
          'net.request': {
            rules: [{ mode: 'allow', phase: 'CONTEXT' }],
          },
        },
      }),
    );

    const decision = await loadAllowlistDecision({
      config: baseConfig,
      repoRoot,
      toolName: 'net.request',
      phase: Phase.CONTEXT,
      sideEffects: ['network'],
    });

    expect(decision).toBe('deny');
  });

  it('prefers user deny over repo allow', async () => {
    const { loadAllowlistDecision } = await loadAllowlistModule();

    // Ensure parent directories exist
    files.set(defaultPathAdapter.resolve(repoRoot, '.salmonloop'), '');
    files.set(defaultPathAdapter.resolve(repoRoot, '.salmonloop', 'config'), '');
    files.set(defaultPathAdapter.resolve(os.homedir(), '.salmonloop'), '');
    files.set(defaultPathAdapter.resolve(os.homedir(), '.salmonloop', 'config'), '');

    setFile(
      repoAllowlistPath,
      JSON.stringify({
        version: 1,
        tools: {
          'net.request': {
            rules: [{ mode: 'allow', phase: 'CONTEXT' }],
          },
        },
      }),
    );

    setFile(
      userAllowlistPath,
      JSON.stringify({
        version: 1,
        tools: {
          'net.request': {
            rules: [{ mode: 'deny', phase: 'CONTEXT' }],
          },
        },
      }),
    );

    const decision = await loadAllowlistDecision({
      config: baseConfig,
      repoRoot,
      toolName: 'net.request',
      phase: Phase.CONTEXT,
      sideEffects: ['network'],
    });

    expect(decision).toBe('deny');
  });

  it('falls back to user allow when repo has no match', async () => {
    const { loadAllowlistDecision } = await loadAllowlistModule();

    // Ensure parent directories exist
    files.set(defaultPathAdapter.resolve(repoRoot, '.salmonloop'), '');
    files.set(defaultPathAdapter.resolve(repoRoot, '.salmonloop', 'config'), '');
    files.set(defaultPathAdapter.resolve(os.homedir(), '.salmonloop'), '');
    files.set(defaultPathAdapter.resolve(os.homedir(), '.salmonloop', 'config'), '');

    setFile(
      repoAllowlistPath,
      JSON.stringify({
        version: 1,
        tools: {},
      }),
    );

    setFile(
      userAllowlistPath,
      JSON.stringify({
        version: 1,
        tools: {
          'fs.read': {
            rules: [{ mode: 'allow', phase: 'CONTEXT' }],
          },
        },
      }),
    );

    const decision = await loadAllowlistDecision({
      config: baseConfig,
      repoRoot,
      toolName: 'fs.read',
      phase: Phase.CONTEXT,
      sideEffects: ['fs_read'],
    });

    expect(decision).toBe('allow');
  });

  it('persists allowlist rules and matches args/side effects', async () => {
    const { loadAllowlistDecision, persistAllowlistDecision } = await loadAllowlistModule();
    await persistAllowlistDecision({
      config: baseConfig,
      repoRoot,
      toolName: 'fs.write',
      phase: Phase.PATCH,
      scope: 'repo',
      sideEffects: ['fs_write'],
      argsHash: 'abc123',
    });

    const match = await loadAllowlistDecision({
      config: baseConfig,
      repoRoot,
      toolName: 'fs.write',
      phase: Phase.PATCH,
      sideEffects: ['fs_write'],
      argsHash: 'abc123',
    });

    const mismatch = await loadAllowlistDecision({
      config: baseConfig,
      repoRoot,
      toolName: 'fs.write',
      phase: Phase.PATCH,
      sideEffects: ['fs_read'],
      argsHash: 'abc123',
    });

    expect(match).toBe('allow');
    expect(mismatch).toBeNull();
  });

  it('removes rules and clears cache', async () => {
    const {
      clearAllowlistCache,
      loadAllowlistDecision,
      persistAllowlistDecision,
      removeAllowlistRule,
    } = await loadAllowlistModule();
    await persistAllowlistDecision({
      config: baseConfig,
      repoRoot,
      toolName: 'git.status',
      phase: Phase.CONTEXT,
      scope: 'repo',
      sideEffects: ['git_read'],
    });

    await removeAllowlistRule({
      config: baseConfig,
      repoRoot,
      scope: 'repo',
      toolName: 'git.status',
      phase: Phase.CONTEXT,
      sideEffects: ['git_read'],
    });

    const saved = JSON.parse(files.get(repoAllowlistPath) ?? '{}');
    expect(saved.tools?.['git.status']).toBeUndefined();

    const decision = await loadAllowlistDecision({
      config: baseConfig,
      repoRoot,
      toolName: 'git.status',
      phase: Phase.CONTEXT,
      sideEffects: ['git_read'],
    });

    expect(decision).toBeNull();

    // Set a cache file to be cleared
    setFile(
      cachePath,
      '{"version":1,"sourcePath":"","sourceMtimeMs":1,"data":{"version":1,"tools":{}}}',
    );
    expect(files.has(cachePath)).toBe(true);

    await clearAllowlistCache({ config: baseConfig, repoRoot });

    expect(files.has(cachePath)).toBe(false);
  });

  it('blocks allowlist paths outside allowed roots', async () => {
    const { loadAllowlistDecision } = await loadAllowlistModule();
    setFile(
      defaultPathAdapter.resolve('/etc/passwd'),
      JSON.stringify({
        version: 1,
        tools: {
          'net.request': {
            rules: [{ mode: 'allow', phase: 'CONTEXT' }],
          },
        },
      }),
    );

    const decision = await loadAllowlistDecision({
      config: {
        ...baseConfig,
        allowlist: {
          repoFile: '/etc/passwd',
          userFile: baseConfig.allowlist?.userFile,
        },
      },
      repoRoot,
      toolName: 'net.request',
      phase: Phase.CONTEXT,
      sideEffects: ['network'],
    });

    expect(decision).toBeNull();
  });
});
