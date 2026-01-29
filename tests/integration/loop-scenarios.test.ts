import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

import { vi, describe, it, expect, beforeEach } from 'vitest';

import { ContextBuilder } from '../../src/core/context.js';
import { injectSmokeTest } from '../../src/core/testgen.js';
import * as verify from '../../src/core/verify.js';

vi.mock('../../src/core/adapters/git/git-adapter.js', () => {
  return {
    GitAdapter: vi.fn().mockImplementation(() => ({
      applyPatch: vi.fn().mockResolvedValue(undefined),
      safeRollback: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue(''),
      exec: vi.fn().mockImplementation((args) => {
        if (args[0] === 'config') return Promise.resolve('mock-value');
        return Promise.resolve('');
      }),
      query: vi.fn().mockResolvedValue(''),
      checkIgnore: vi.fn().mockResolvedValue(false),
    })),
  };
});
vi.mock('../../src/core/verify.js');
vi.mock('../../src/core/ast/parser.js');
vi.mock('../../src/core/context.js', () => ({
  ContextBuilder: {
    build: vi.fn(),
    shrinkContext: vi.fn().mockImplementation((ctx) => Promise.resolve(ctx)),
    extractFailedFiles: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn().mockResolvedValue(undefined),
    lstat: vi.fn().mockResolvedValue({ isDirectory: () => false, isSymbolicLink: () => false }),
    rename: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  lstat: vi.fn().mockResolvedValue({ isDirectory: () => false, isSymbolicLink: () => false }),
  rename: vi.fn().mockResolvedValue(undefined),
}));

describe('SalmonLoop Scenarios', () => {
  const repoPath = resolve('fake-repo');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verify.preflight).mockResolvedValue({ ok: true });
    vi.mocked(ContextBuilder.build).mockResolvedValue({
      repoPath,
      primaryText: 'content',
      rgSnippets: [],
    } as any);

    // Default fs mocks
    vi.mocked(readFile).mockImplementation((path) => {
      if (path.toString().includes('app.ts'))
        return Promise.resolve('function main() { console.log("hello"); }');
      return Promise.resolve('');
    });
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  it('Scenario: Multilingual Project Detection and Test Injection', async () => {
    const pythonRepo = '/python-repo';

    // Mock existsSync to simulate requirements.txt exists, but smoke test doesn't
    vi.mocked(existsSync).mockImplementation((path) => {
      if (path.toString().includes('requirements.txt')) return true;
      if (path.toString().includes('salmon_smoke_test.py')) return false;
      return false;
    });

    const result = await injectSmokeTest(pythonRepo);
    expect(result.created).toBe(true);
    expect(result.testCommand).toBe('python salmon_smoke_test.py');
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('salmon_smoke_test.py'),
      expect.any(String),
      'utf-8',
    );
  });
});
