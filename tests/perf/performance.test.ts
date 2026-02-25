import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execa } from 'execa';

import { AstParser } from '../../src/core/ast/parser.js';
import { ContextBuilder } from '../../src/core/context/builder.js';
import { LLM } from '../../src/core/llm/index.js';
import { runSalmonLoop } from '../../src/core/runtime/loop.js';
import * as verify from '../../src/core/verification/runner.js';

const mockLlm = {
  createPlan: mock(),
  createPatch: mock(),
  chat: mock().mockResolvedValue({ role: 'assistant', content: 'Ready' }),
} as unknown as LLM;

describe('Performance Tests', () => {
  let repoPath: string;

  beforeEach(async () => {
    useRealTimers();
    mock.clearAllMocks();

    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'salmon-loop-perf-'));
    await fs.mkdir(path.join(repoPath, '.git'), { recursive: true });

    const filePromises: Promise<unknown>[] = [];
    for (let i = 0; i < 1000; i++) {
      filePromises.push(
        fs.writeFile(path.join(repoPath, `file${i}.ts`), `console.log("file ${i}");\n`),
      );
    }
    await Promise.all(filePromises);

    await execa('git', ['init', '--initial-branch=main'], { cwd: repoPath });
    await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: repoPath });
    await execa('git', ['config', 'user.name', 'test'], { cwd: repoPath });
    await execa('git', ['add', '.'], { cwd: repoPath });
    await execa('git', ['commit', '-m', 'Initial commit'], { cwd: repoPath });

    spyOn(verify, 'preflight').mockResolvedValue({ ok: true });
    spyOn(verify, 'runVerify').mockResolvedValue({ ok: true, output: '', exitCode: 0 });

    spyOn(ContextBuilder, 'build').mockResolvedValue({
      repoPath,
      rgSnippets: [],
      primaryText: '',
    } as any);
    spyOn(ContextBuilder, 'shrinkContext').mockImplementation(async (ctx: any) => ctx);
    spyOn(ContextBuilder, 'extractFailedFiles').mockReturnValue([]);

    spyOn(AstParser, 'parse').mockResolvedValue({ delete: mock() } as any);
    spyOn(AstParser, 'identifyDefinitions').mockResolvedValue([]);
    spyOn(AstParser, 'identifyReferences').mockResolvedValue([]);
  });

  afterEach(async () => {
    mock.restore();
    if (repoPath) {
      await fs.rm(repoPath, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('should handle a large repository without significant delay', async () => {
    (mockLlm.createPlan as any).mockResolvedValue({
      goal: 'Fix',
      files: ['file0.ts'],
      changes: ['Fix log'],
      verify: 'echo "passed"',
    });

    (mockLlm.createPatch as any).mockResolvedValue(
      'diff --git a/file0.ts b/file0.ts\n' +
        '--- a/file0.ts\n' +
        '+++ b/file0.ts\n' +
        '@@ -1,1 +1,1 @@\n' +
        '-console.log("file 0");\n' +
        '+console.log("fixed");\n',
    );

    const start = Date.now();
    const result = await runSalmonLoop({
      instruction: 'Fix file0',
      verify: 'echo "passed"',
      repoPath,
      llm: mockLlm,
      forceReset: true,
    });
    const end = Date.now();

    expect(result.success).toBe(true);
    expect(end - start).toBeLessThan(5000);
  });
});
