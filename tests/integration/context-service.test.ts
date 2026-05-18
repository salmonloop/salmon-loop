import { ContextService } from '../../src/core/context/service.js';
import { PluginLoader } from '../../src/core/plugin/loader.js';
import { getPluginRegistry } from '../../src/core/plugin/registry.js';
import {
  createLocalCommandRunner,
  withCommandRunner,
} from '../../src/core/runtime/command-runner-context.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('ContextService Integration', () => {
  const helper = new RealFsTestHelper();
  let repoPath: string;

  beforeAll(async () => {
    await PluginLoader.loadPlugins(getPluginRegistry());
  });

  beforeEach(async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        {
          path: 'src/a.ts',
          content: "import { b } from './b.js';\n\nexport function a() {\n  return b();\n}\n",
        },
        {
          path: 'src/b.ts',
          content: 'export function b() {\n  return 1;\n}\n',
        },
      ],
    });
    repoPath = repo.path;
  });

  afterEach(async () => {
    await helper.cleanup();
  });

  it('includes dependency diffs in ast_related scope', async () => {
    await helper.writeFile(repoPath, 'src/b.ts', 'export function b() {\n  return 2;\n}\n');

    const service = new ContextService();
    const result = await service.build({
      instruction: 'hi',
      repoPath,
      primaryFile: 'src/a.ts',
      diffScope: 'ast_related',
    });

    expect(result.context.unstagedDiff || '').toContain('src/b.ts');
    expect(result.meta.diffScope).toBe('ast_related');
    expect((result.context.relatedFiles || []).some((f) => f.path === 'src/b.ts')).toBe(true);
    expect(result.prompt).toContain('src/b.ts');
  });

  it('includes matched source files when the request does not name a primary file', async () => {
    await helper
      .createGitRepo({
        initialFiles: [
          {
            path: 'src/rules/L031.py',
            content: 'def lint_aliases():\n    return "Avoid using aliases in join condition"\n',
          },
          {
            path: 'docs/rules.md',
            content: 'L031 is documented here.\n',
          },
        ],
      })
      .then((repo) => {
        repoPath = repo.path;
      });

    const service = new ContextService();
    const result = await service.build({
      instruction:
        'TSQL - L031 incorrectly triggers "Avoid using aliases in join condition" when no join present',
      repoPath,
    });

    expect(result.prompt).toContain('src/rules/L031.py');
    expect(result.prompt).toContain('Avoid using aliases in join condition');
  });

  it('includes matched source files when external code search is unavailable', async () => {
    await helper
      .createGitRepo({
        initialFiles: [
          {
            path: 'src/rules/L031.py',
            content: 'def lint_aliases():\n    return "Avoid using aliases in join condition"\n',
          },
          {
            path: 'docs/rules.md',
            content: 'L031 is documented here.\n',
          },
        ],
      })
      .then((repo) => {
        repoPath = repo.path;
      });

    const localRunner = createLocalCommandRunner();
    const service = new ContextService();
    const result = await withCommandRunner(
      {
        ...localRunner,
        spawnCommand: async (input) => {
          if (input.command === 'rg') {
            return {
              code: -1,
              signal: null,
              timedOut: false,
              error: { code: 'ENOENT', message: 'spawn rg ENOENT' },
              stdout: '',
              stderr: '',
              stdoutTruncated: false,
              stderrTruncated: false,
            };
          }
          return await localRunner.spawnCommand(input);
        },
      },
      async () =>
        service.build({
          instruction:
            'TSQL - L031 incorrectly triggers "Avoid using aliases in join condition" when no join present',
          repoPath,
        }),
    );

    expect(result.prompt).toContain('src/rules/L031.py');
    expect(result.prompt).toContain('Avoid using aliases in join condition');
  });
});
