import { OpType } from '../../../../../src/core/grizzco/domain/grizzco-types.js';
import { registry } from '../../../../../src/core/grizzco/services/registry.js';
import { createMockContext } from '../mocks.js';

// Mock dependencies to avoid side effects
mock.module('../../../../../src/core/grizzco/execution/Executor.js', () => ({
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

mock.module('../../../../../src/core/grizzco/execution/WorkerFactory.js', () => ({
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
    const { runApply } = await import('../../../../../src/core/grizzco/steps/apply.js');
    // 1. Setup Spies
    const mockService = {
      id: 'remote_lock',
      fetch: mock().mockResolvedValue({ isLocked: false }),
    };

    // 2. Register them BEFORE runApply
    registry.register(mockService);

    // 3. Create a comprehensive Mock Context
    const ctx = createMockContext();

    // Setup FileStateResolver Mock
    (ctx as any).fileStateResolver = {
      getWorkspaceMap: mock().mockResolvedValue(
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
      convertDiffToShadowOperations: mock().mockResolvedValue([
        { path: 'test.ts', type: OpType.PATCH, content: Buffer.from('mock-diff-content') },
      ]),
    };

    (ctx as any).emit = mock();
    (ctx as any).workspace = { workPath: '/mock/repo' };
    (ctx as any).diff =
      'diff --git a/test.ts b/test.ts\n--- a/test.ts\n+++ b/test.ts\n@@ -1,1 +1,1 @@\n-old\n+new';

    // 4. Execute
    const result = await runApply(ctx as any);

    // 5. Verify
    expect(result.applyResult.success).toBe(true);

    // We check if fetch was called.
    expect(mockService.fetch).toHaveBeenCalled();
  });
});
