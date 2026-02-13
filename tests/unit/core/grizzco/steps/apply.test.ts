import { OpType } from '../../../../../src/core/grizzco/domain/grizzco-types.js';
import { registry } from '../../../../../src/core/grizzco/services/registry.js';
import { runApply } from '../../../../../src/core/grizzco/steps/apply.js';
import { createMockContext } from '../mocks.js';

// Mock dependencies to avoid side effects
vi.mock('../../../../../src/core/grizzco/execution/Executor.js', () => ({
  Executor: class {
    execute() {
      return Promise.resolve({
        success: true,
        actionTaken: 'MERGE(git-apply)',
        path: 'test.ts',
        workerId: 'git-apply',
        executionTime: 10,
      });
    }
  },
}));

vi.mock('../../../../../src/core/grizzco/execution/WorkerFactory.js', () => ({
  WorkerFactory: class {
    constructor() {}
  },
}));

describe('Apply Step (MicroOrchestrator)', () => {
  beforeEach(() => {
    // Force clear registry to ensure test isolation
    const reg = registry as any;
    if (reg.services) reg.services.clear();
  });

  it('should resolve data requirements via registry', async () => {
    // 1. Setup Spies
    const mockService = {
      id: 'remote_lock',
      fetch: vi.fn().mockResolvedValue({ isLocked: false }),
    };
    const mockGitConfig = {
      id: 'git_config',
      fetch: vi.fn().mockResolvedValue({ user: { name: 'Test', email: 'test@example.com' } }),
    };

    // 2. Register them BEFORE runApply
    registry.register(mockService);
    registry.register(mockGitConfig);

    // 3. Create a comprehensive Mock Context
    const ctx = createMockContext();

    // Setup FileStateResolver Mock
    (ctx as any).fileStateResolver = {
      getWorkspaceMap: vi.fn().mockResolvedValue(
        new Map([
          [
            'test.ts',
            {
              path: 'test.ts',
              status: 'CLEAN',
              isBinary: false,
              isSymlink: false,
              isIgnored: false,
              size: 100,
            },
          ],
        ]),
      ),
    };

    // Setup GrizzcoSystem Mock (used for diff conversion in loop.ts, but here in apply.ts)
    (ctx as any).grizzcoSystem = {
      convertDiffToShadowOperations: vi
        .fn()
        .mockResolvedValue([
          { path: 'test.ts', type: OpType.PATCH, content: Buffer.from('mock-diff-content') },
        ]),
    };

    (ctx as any).emit = vi.fn();
    (ctx as any).workspace = { workPath: '/mock/repo' };
    (ctx as any).diff =
      'diff --git a/test.ts b/test.ts\n--- a/test.ts\n+++ b/test.ts\n@@ -1,1 +1,1 @@\n-old\n+new';

    // 4. Execute
    const result = await runApply(ctx as any);

    // 5. Verify
    expect(result.applyResult.success).toBe(true);

    // We check if fetch was called.
    expect(mockService.fetch).toHaveBeenCalled();
    expect(mockGitConfig.fetch).toHaveBeenCalled();
  });
});
