import * as crypto from 'crypto';
import * as os from 'os';

import {
  clearAllowlistCache,
  loadAllowlistDecision,
  persistAllowlistDecision,
  removeAllowlistRule,
} from '../../../../src/cli/authorization/allowlist.js';
import type { ToolAuthorizationConfig } from '../../../../src/core/config/types.js';
import { Phase } from '../../../../src/core/types.js';

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

vi.mock('fs/promises', () => ({
  readFile: vi.fn(async (filePath: string) => {
    if (!files.has(filePath)) {
      const error: any = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      throw error;
    }
    return files.get(filePath) as string;
  }),
  writeFile: vi.fn(async (filePath: string, data: string | Buffer) => {
    const content = typeof data === 'string' ? data : data.toString();
    setFile(filePath, content);
  }),
  open: vi.fn(async (filePath: string, flags?: string) => {
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
  mkdir: vi.fn(async () => undefined),
  stat: vi.fn(async (filePath: string) => {
    if (!files.has(filePath)) {
      const error: any = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      throw error;
    }
    const content = files.get(filePath) ?? '';
    return { mtimeMs: mtimes.get(filePath) ?? 1, size: content.length } as any;
  }),
  rename: vi.fn(async (from: string, to: string) => {
    if (!files.has(from)) {
      const error: any = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      throw error;
    }
    const content = files.get(from) as string;
    files.set(to, content);
    files.delete(from);
  }),
  unlink: vi.fn(async (filePath: string) => {
    if (!files.has(filePath)) {
      const error: any = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      throw error;
    }
    removeFile(filePath);
  }),
}));

const repoRoot = '/repo';
const repoAllowlistPath = '/repo/.salmonloop/config/authorization.json';
const userAllowlistPath = `${os.homedir()}/.salmonloop/config/authorization-user.json`;
const cachePath = `/repo/.salmonloop/state/allowlist-cache-${crypto
  .createHash('sha256')
  .update(repoAllowlistPath)
  .digest('hex')}.json`;

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
    vi.clearAllMocks();
  });

  it('prefers repo deny over user allow', async () => {
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
    const cached = JSON.parse(files.get(cachePath) ?? '{}');
    expect(cached.data?.tools?.['git.status']).toBeUndefined();

    const decision = await loadAllowlistDecision({
      config: baseConfig,
      repoRoot,
      toolName: 'git.status',
      phase: Phase.CONTEXT,
      sideEffects: ['git_read'],
    });

    setFile(
      cachePath,
      '{"version":1,"sourcePath":"","sourceMtimeMs":1,"data":{"version":1,"tools":{}}}',
    );
    await clearAllowlistCache({ config: baseConfig, repoRoot });

    expect(decision).toBeNull();
    expect(files.has(cachePath)).toBe(false);
  });

  it('blocks allowlist paths outside allowed roots', async () => {
    setFile(
      '/etc/passwd',
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
