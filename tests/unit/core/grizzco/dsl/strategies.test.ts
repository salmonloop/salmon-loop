import { FileStatus, OpType } from '../../../../../src/core/grizzco/domain/grizzco-types.js';
import { DecisionEngine, PlanBuilder } from '../../../../../src/core/grizzco/dsl/DecisionEngine.js';
import {
  SafetyChecks,
  IndexProtection,
  MMHandling,
  IntentRouting,
} from '../../../../../src/core/grizzco/dsl/strategies.js';
import { createMockContext } from '../mocks.js';

describe('Strategies', () => {
  describe('SafetyChecks', () => {
    it('should pass for valid file', () => {
      const ctx = createMockContext();
      ctx.data = {
        remote_lock: { isLocked: false },
        git_config: { user: { name: 'User', email: 'email' } },
      };
      const pb = new PlanBuilder();
      const engine = new DecisionEngine(ctx, pb);
      SafetyChecks(engine);
      const result = engine.build();

      expect(result.type).toBe('PLAN');
      if (result.type === 'PLAN') {
        expect(result.plan.shouldAbort).toBe(false);
      }
    });

    it('should reject symlinks', () => {
      const ctx = createMockContext({ file: { ...createMockContext().file, isSymlink: true } });
      ctx.data = {
        remote_lock: { isLocked: false },
        git_config: { user: { name: 'User', email: 'email' } },
      };
      const pb = new PlanBuilder();
      const engine = new DecisionEngine(ctx, pb);
      SafetyChecks(engine);
      const result = engine.build();

      expect(result.type).toBe('PLAN');
      if (result.type === 'PLAN') {
        expect(result.plan.shouldAbort).toBe(true);
        expect(result.plan.abortReason).toMatch(/Symlinks are not supported/);
      }
    });
  });

  describe('IntentRouting', () => {
    it('should select git-apply for PATCH operations', () => {
      const ctx = createMockContext({
        operation: { type: OpType.PATCH, path: 'test.ts', content: Buffer.from('diff') },
      });
      const pb = new PlanBuilder();
      const engine = new DecisionEngine(ctx, pb);
      IntentRouting(engine);
      const result = engine.build();

      expect(result.type).toBe('PLAN');
      if (result.type === 'PLAN') {
        expect(result.plan.workerId).toBe('git-apply');
      }
    });

    it('should select direct-write for OVERWRITE operations', () => {
      const ctx = createMockContext({
        operation: { type: OpType.OVERWRITE, path: 'test.ts', content: Buffer.from('new content') },
      });
      const pb = new PlanBuilder();
      const engine = new DecisionEngine(ctx, pb);
      IntentRouting(engine);
      const result = engine.build();

      expect(result.type).toBe('PLAN');
      if (result.type === 'PLAN') {
        expect(result.plan.workerId).toBe('direct-write');
      }
    });
  });

  describe('IndexProtection', () => {
    it('should abort STAGED_MODIFIED without force', () => {
      const ctx = createMockContext({
        file: { ...createMockContext().file, status: FileStatus.STAGED_MODIFIED },
        options: { force: false } as any,
      });
      const pb = new PlanBuilder();
      const engine = new DecisionEngine(ctx, pb);
      IndexProtection(engine);
      const result = engine.build();

      expect(result.type).toBe('PLAN');
      if (result.type === 'PLAN') {
        expect(result.plan.shouldAbort).toBe(true);
      }
    });
  });

  describe('MMHandling', () => {
    it('should select 3way-mm-advanced for MM files', () => {
      const ctx = createMockContext({
        file: { ...createMockContext().file, status: FileStatus.MM },
        options: { force: false } as any,
      });
      const pb = new PlanBuilder();
      const engine = new DecisionEngine(ctx, pb);
      MMHandling(engine);
      const result = engine.build();

      expect(result.type).toBe('PLAN');
      if (result.type === 'PLAN') {
        expect(result.plan.workerId).toBe('3way-mm-advanced');
      }
    });

    it('should not override PATCH routing for MM files (keep git-apply)', () => {
      const ctx = createMockContext({
        file: { ...createMockContext().file, status: FileStatus.MM },
        operation: { type: OpType.PATCH, path: 'test.ts', content: Buffer.from('diff') },
        options: { force: false } as any,
      });
      const pb = new PlanBuilder();
      const engine = new DecisionEngine(ctx, pb);
      IntentRouting(engine);
      MMHandling(engine);
      const result = engine.build();

      expect(result.type).toBe('PLAN');
      if (result.type === 'PLAN') {
        expect(result.plan.workerId).toBe('git-apply');
      }
    });
  });
});
