import { WorkerFactory } from '../../../../../src/core/grizzco/execution/WorkerFactory.js';
import { createMockContext } from '../mocks.js';

// Mock dependencies
mock.module('../../../../../src/core/adapters/fs/index.js', () => ({
  AtomicFileWriter: class {
    writeAtomic = mock();
  },
  FileAdapter: class {},
}));

mock.module('../../../../../src/core/grizzco/execution/RejectionManager.js', () => ({
  RejectionManager: class {
    create = mock();
  },
}));

describe('Executor', () => {
  it('should execute worker and write result', async () => {
    const { Executor } = await import('../../../../../src/core/grizzco/execution/Executor.js');
    const mockWorker = {
      execute: mock().mockResolvedValue({
        success: true,
        mergedContent: Buffer.from('merged'),
      }),
    };

    const workerFactory = {
      get: mock().mockReturnValue(mockWorker),
    } as unknown as WorkerFactory;

    const executor = new Executor(workerFactory, '.salmonloop/runtime/rej');
    const ctx = createMockContext();
    const plan = {
      shouldAbort: false,
      workerId: 'mock-worker',
      actions: [],
      decisionTree: [],
    };

    const result = await executor.execute(plan, ctx);

    expect(result.success).toBe(true);
    expect(result.actionTaken).toContain('MERGE');
    expect(mockWorker.execute).toHaveBeenCalled();
  });

  it('should handle worker failure', async () => {
    const { Executor } = await import('../../../../../src/core/grizzco/execution/Executor.js');
    const mockWorker = {
      execute: mock().mockResolvedValue({
        success: false,
        error: 'Merge error',
      }),
    };

    const workerFactory = {
      get: mock().mockReturnValue(mockWorker),
    } as unknown as WorkerFactory;

    const executor = new Executor(workerFactory, '.salmonloop/runtime/rej');
    const ctx = createMockContext();
    const plan = {
      shouldAbort: false,
      workerId: 'mock-worker',
      actions: [],
      decisionTree: [],
    };

    const result = await executor.execute(plan, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Merge error');
  });
});
