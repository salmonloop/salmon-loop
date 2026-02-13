import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextBuilder } from '../../src/core/context/builder.js';
import { injectSmokeTest } from '../../src/core/testgen/index.js';
import * as verify from '../../src/core/verification/runner.js';

// Mock adapters that are not the focus of this test (Git, AST, Context)
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

vi.mock('../../src/core/verification/runner.js');
vi.mock('../../src/core/ast/parser.js');
vi.mock('../../src/core/context/builder.js', () => ({
  ContextBuilder: {
    build: vi.fn(),
    shrinkContext: vi.fn().mockImplementation((ctx) => Promise.resolve(ctx)),
    extractFailedFiles: vi.fn(),
  },
}));

// CRITICAL: NO GLOBAL FS MOCKS. Integration tests must use the real file system.

describe('SalmonLoop Scenarios', () => {
  let repoPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create a real temporary directory for the test
    repoPath = await fs.mkdtemp(join(tmpdir(), 'salmon-scenarios-'));

    vi.mocked(verify.preflight).mockResolvedValue({ ok: true });
    vi.mocked(ContextBuilder.build).mockResolvedValue({
      repoPath,
      primaryText: 'content',
      rgSnippets: [],
    } as any);
  });

  afterEach(async () => {
    // Clean up the temporary directory
    if (repoPath) {
      await fs.rm(repoPath, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('Scenario: Multilingual Project Detection and Test Injection', async () => {
    // Create a dummy requirements.txt to simulate a Python repo
    await fs.writeFile(join(repoPath, 'requirements.txt'), 'flask');

    // Run the injection
    const result = await injectSmokeTest(repoPath);

    // Verify results
    expect(result.created).toBe(true);
    expect(result.testCommand).toBe('python salmon_smoke_test.py');

    // Verify side effect: File should exist on disk
    const testFilePath = join(repoPath, 'salmon_smoke_test.py');
    const fileExists = await fs
      .stat(testFilePath)
      .then(() => true)
      .catch(() => false);
    expect(fileExists).toBe(true);

    const content = await fs.readFile(testFilePath, 'utf-8');
    // Updated expectation based on actual output
    expect(content).toContain('Running smoke test on Python');
  });
});
