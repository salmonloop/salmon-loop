import { DslContext, PlanBuilder } from '../../../src/core/grizzco/dsl/DecisionEngine.js';
import { FileStatus, OpType } from '../../../src/core/shared/types/grizzco-types.js';

export const createMockContext = (overrides: Partial<DslContext> = {}): DslContext => ({
  repoRoot: '/mock/repo',
  file: {
    path: 'test.ts',
    status: FileStatus.CLEAN,
    isBinary: false,
    isSymlink: false,
    isIgnored: false,
    hasConflict: false,
    size: 100,
  },
  operation: { type: OpType.OVERWRITE, path: 'test.ts', content: Buffer.from('new') },
  options: {
    force: false,
    allowMM: false,
    safeMode: true,
    dryRun: false,
    rejectDir: '.s8p/rejections',
    maxFileSize: 10 * 1024 * 1024,
  },
  snapshot: { exists: true, id: 'mock-initial-ref', timestamp: 0, path: '' },
  runtime: { needsRollback: false },
  data: {},
  ...overrides,
});

export const createMockPlanBuilder = () => new PlanBuilder();
