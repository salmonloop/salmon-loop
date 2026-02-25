import { AstParser } from '../../src/core/ast/parser.js';
import { LLM } from '../../src/core/llm/index.js';
import { runSalmonLoop } from '../../src/core/runtime/loop.js';
import { buildBunCommand } from '../helpers/bun.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

const mockLlm = {
  createPlan: mock(),
  createPatch: mock(),
  chat: mock().mockResolvedValue({ role: 'assistant', content: 'Ready' }),
} as unknown as any;

describe('Fuzzy Patch Loop Integration', () => {
  const helper = new RealFsTestHelper();
  const bunCommand = (args: string) => buildBunCommand(args);
  let repoPath: string;

  beforeEach(async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        {
          path: 'app.js',
          content: 'function main() {\n  console.log("start");\n}\n',
        },
      ],
    });
    repoPath = repo.path;

    mock.clearAllMocks();

    spyOn(AstParser, 'parse').mockResolvedValue({} as any);
    spyOn(AstParser, 'identifyDefinitions').mockResolvedValue([]);
    spyOn(AstParser, 'identifyReferences').mockResolvedValue([]);
  });

  afterEach(async () => {
    await helper.cleanup();
    mock.restore();
  });

  it('should succeed when patch has minor formatting differences (fuzzy match)', async () => {
    mockLlm.createPlan.mockResolvedValue({
      goal: 'Update log message',
      files: ['app.js'],
      changes: ['Change start to begin'],
      verify: bunCommand('app.js'),
    });

    // LLM generates a patch with extra space in context line (fuzzy)
    // Note: Real git apply might fail if it's TOO fuzzy, but SalmonLoop has
    // internal logic to handle/retry or the underlying git might handle some whitespace.
    // Here we test SalmonLoop's ability to drive the process.
    const fuzzyPatch =
      'diff --git a/app.js b/app.js\n' +
      '--- a/app.js\n' +
      '+++ b/app.js\n' +
      '@@ -1,3 +1,3 @@\n' +
      ' function main() {\n' +
      '-  console.log("start");\n' +
      '+  console.log("begin");\n' +
      ' }';

    mockLlm.createPatch.mockResolvedValue(fuzzyPatch);

    const result = await runSalmonLoop({
      instruction: 'Update log message',
      verify: bunCommand('app.js'),
      repoPath: repoPath,
      file: 'app.js',
      llm: mockLlm as unknown as LLM,
    });

    expect(result.success).toBe(true);

    // State assertion: verify the file content actually changed.
    const content = await helper.readFile(repoPath, 'app.js');
    expect(content).toContain('console.log("begin")');
    expect(content).not.toContain('console.log("start")');
  }, 20000);
});
