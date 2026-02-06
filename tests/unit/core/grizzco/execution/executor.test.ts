import { Executor } from '../../../../../src/core/grizzco/execution/Executor.js';
import { WorkerFactory } from '../../../../../src/core/grizzco/execution/WorkerFactory.js';
import { createMockContext } from '../mocks.js';

// Mock dependencies
vi.mock('../../../../../src/core/adapters/fs/index.js', () => ({
  AtomicFileWriter: class {
    writeAtomic = vi.fn();
  },
}));

vi.mock('../../../../../src/core/grizzco/execution/RejectionManager.js', () => ({
  RejectionManager: class {
    create = vi.fn();
  },
}));

describe('Executor', () => {
  it('should execute worker and write result', async () => {
    const mockWorker = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        mergedContent: Buffer.from('merged'),
      }),
    };

    const workerFactory = {
      get: vi.fn().mockReturnValue(mockWorker),
    } as unknown as WorkerFactory;

    const executor = new Executor(workerFactory, '.salmonloop/runtime/rej');
    const ctx = createMockContext();
    const plan = {
      shouldAbort: false,
      workerId: 'mock-worker',
      actions: [],
      decisionTree: '',
    };

    const result = await executor.execute(plan, ctx);

    expect(result.success).toBe(true);
    expect(result.actionTaken).toContain('MERGE');
    expect(mockWorker.execute).toHaveBeenCalled();
  });

  it('should handle worker failure', async () => {
    const mockWorker = {
      execute: vi.fn().mockResolvedValue({
        success: false,
        error: 'Merge error',
      }),
    };

    const workerFactory = {
      get: vi.fn().mockReturnValue(mockWorker),
    } as unknown as WorkerFactory;

    const executor = new Executor(workerFactory, '.salmonloop/runtime/rej');
    const ctx = createMockContext();
    const plan = {
      shouldAbort: false,
      workerId: 'mock-worker',
      actions: [],
      decisionTree: '',
    };

    const result = await executor.execute(plan, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Merge error');
  });
});
