import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

import { vi, describe, it, expect, beforeEach } from 'vitest';

import { AstParser } from '../../src/core/ast/parser.js';
import { ContextBuilder } from '../../src/core/context.js';
import * as git from '../../src/core/git.js';
import { StubLLM } from '../../src/core/llm.js';
import { injectSmokeTest } from '../../src/core/testgen.js';
import * as verify from '../../src/core/verify.js';
import { runSalmonLoop } from '../../src/index.js';

vi.mock('../../src/core/git.js');
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
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

describe('SalmonLoop Scenarios', () => {
  const repoPath = resolve('fake-repo');
  let mockLLM: StubLLM;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLLM = new StubLLM();
    vi.mocked(git.applyPatch).mockResolvedValue(undefined);
    vi.mocked(git.rollbackFiles).mockResolvedValue({ ok: true } as any);
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

  it('Scenario: AST Error -> Retry -> Success with Smart Feedback', async () => {
    const validPatch = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-function main() { console.log("hello"); }
+function main() { console.log("hello world"); }`;

    mockLLM.createPlan = vi.fn().mockResolvedValue({
      goal: 'fix',
      files: ['src/app.ts'],
      changes: ['change'],
      verify: 'npm test',
    });
    mockLLM.createPatch = vi.fn().mockResolvedValue(validPatch);

    // 1. First attempt: AST Error
    vi.mocked(AstParser.parse).mockResolvedValueOnce({
      walk: () => ({
        currentNode: {
          type: 'ERROR',
          startPosition: { row: 1, column: 1 },
          text: 'error',
          isMissing: () => false,
        },
        gotoFirstChild: () => false,
        gotoNextSibling: () => false,
        gotoParent: () => false,
      }),
    } as any);

    // 2. Second attempt: AST OK, but Verify Fails (TSC Error)
    vi.mocked(AstParser.parse).mockResolvedValue({
      walk: () => ({
        currentNode: { type: 'program', isMissing: () => false },
        gotoFirstChild: () => false,
        gotoNextSibling: () => false,
        gotoParent: () => false,
      }),
    } as any);

    vi.mocked(verify.runVerify).mockResolvedValueOnce({
      ok: false,
      output: 'src/app.ts(10,5): error TS2322: Type "string" is not assignable to type "number".',
      exitCode: 1,
    });

    // 3. Third attempt: Success
    vi.mocked(verify.runVerify).mockResolvedValueOnce({
      ok: true,
      output: 'Success',
      exitCode: 0,
    });

    const createPlanSpy = vi.spyOn(mockLLM, 'createPlan');

    const result = await runSalmonLoop({
      instruction: 'fix',
      verify: 'npm test',
      repoPath,
      llm: mockLLM,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBeGreaterThanOrEqual(2);

    const lastCall = createPlanSpy.mock.calls[createPlanSpy.mock.calls.length - 1];
    const lastErrorArg = lastCall[2];
    expect(lastErrorArg).toBeDefined();
    expect(lastErrorArg).toContain('Critical Errors found');
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
