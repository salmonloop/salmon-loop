import type { BudgetMetrics } from '../../../src/core/context/budget/dynamic-adjuster.js';
import {
  collectBudgetMetrics,
  applyBudgetAdjustment,
  getGlobalAdjuster,
  evaluateBudgetAlert,
} from '../../../src/core/context/budget/integration.js';
import type { ContextResult, DroppedContextSections } from '../../../src/core/context/types.js';
import type { VerifyResult } from '../../../src/core/verification/runner.js';

describe('Budget Integration', () => {
  // Reset global adjuster before each test to ensure isolation
  beforeEach(() => {
    getGlobalAdjuster().reset();
  });

  afterEach(() => {
    getGlobalAdjuster().reset();
  });

  const createDroppedSections = (
    overrides: Partial<DroppedContextSections> = {},
  ): DroppedContextSections => ({
    stagedDiff: false,
    unstagedDiff: false,
    gitDiff: false,
    untrackedDiff: false,
    ...overrides,
  });

  const createContextResult = (overrides: Partial<ContextResult['meta']> = {}): ContextResult => ({
    context: {
      repoPath: '/repo',
      primaryFile: 'test.ts',
      primaryText: 'content',
      rgSnippets: [],
    },
    prompt: 'test prompt',
    meta: {
      usedChars: 25000,
      truncated: false,
      diffScope: 'primary',
      includedFiles: ['test.ts'],
      sectionChars: {
        primary: 1000,
        relatedFiles: 0,
        rgSnippets: 0,
        diffs: 0,
        total: 1000,
      },
      requestedBudgetChars: 30000,
      ...overrides,
    },
  });

  const createVerifyResult = (success: boolean): VerifyResult => ({
    ok: success,
    output: success ? 'All tests passed' : 'Tests failed',
    exitCode: success ? 0 : 1,
  });

  const createBudgetMetrics = (overrides: Partial<BudgetMetrics> = {}): BudgetMetrics => ({
    budgetAllocated: 30000,
    tokensUsed: 25000,
    wasTruncated: false,
    criticalContentDropped: false,
    verifySuccess: true,
    iteration: 1,
    ...overrides,
  });

  describe('collectBudgetMetrics', () => {
    it('should collect basic metrics from context result', () => {
      const contextResult = createContextResult();
      const metrics = collectBudgetMetrics({
        contextResult,
        iteration: 1,
      });

      expect(metrics.budgetAllocated).toBe(30000);
      expect(metrics.tokensUsed).toBe(25000);
      expect(metrics.wasTruncated).toBe(false);
      expect(metrics.iteration).toBe(1);
      expect(metrics.verifySuccess).toBe(false); // No verify result provided
      expect(metrics.criticalContentDropped).toBe(false);
    });

    it('should use default values when meta fields are undefined', () => {
      const contextResult = createContextResult({
        requestedBudgetChars: undefined,
        usedChars: undefined,
        truncated: undefined,
      });

      const metrics = collectBudgetMetrics({
        contextResult,
        iteration: 2,
      });

      expect(metrics.budgetAllocated).toBe(30000); // Default
      expect(metrics.tokensUsed).toBe(0); // Default
      expect(metrics.wasTruncated).toBe(false); // Default
      expect(metrics.iteration).toBe(2);
    });

    it('should detect critical content dropped from staged diff', () => {
      const contextResult = createContextResult({
        droppedSections: createDroppedSections({ stagedDiff: true }),
      });

      const metrics = collectBudgetMetrics({
        contextResult,
        iteration: 1,
      });

      expect(metrics.criticalContentDropped).toBe(true);
    });

    it('should detect critical content dropped from unstaged diff', () => {
      const contextResult = createContextResult({
        droppedSections: createDroppedSections({ unstagedDiff: true }),
      });

      const metrics = collectBudgetMetrics({
        contextResult,
        iteration: 1,
      });

      expect(metrics.criticalContentDropped).toBe(true);
    });

    it('should detect critical content dropped from git diff', () => {
      const contextResult = createContextResult({
        droppedSections: createDroppedSections({ gitDiff: true }),
      });

      const metrics = collectBudgetMetrics({
        contextResult,
        iteration: 1,
      });

      expect(metrics.criticalContentDropped).toBe(true);
    });

    it('should not flag critical content dropped when all diffs present', () => {
      const contextResult = createContextResult({
        droppedSections: createDroppedSections(),
      });

      const metrics = collectBudgetMetrics({
        contextResult,
        iteration: 1,
      });

      expect(metrics.criticalContentDropped).toBe(false);
    });

    it('should handle undefined droppedSections', () => {
      const contextResult = createContextResult({
        droppedSections: undefined,
      });

      const metrics = collectBudgetMetrics({
        contextResult,
        iteration: 1,
      });

      expect(metrics.criticalContentDropped).toBe(false);
    });

    it('should capture verification success from verify result', () => {
      const contextResult = createContextResult();
      const verifyResult = createVerifyResult(true);

      const metrics = collectBudgetMetrics({
        contextResult,
        verifyResult,
        iteration: 1,
      });

      expect(metrics.verifySuccess).toBe(true);
    });

    it('should capture verification failure from verify result', () => {
      const contextResult = createContextResult();
      const verifyResult = createVerifyResult(false);

      const metrics = collectBudgetMetrics({
        contextResult,
        verifyResult,
        iteration: 1,
      });

      expect(metrics.verifySuccess).toBe(false);
    });
  });

  describe('applyBudgetAdjustment', () => {
    it('should return null when no adjustment is needed', () => {
      // First call should not recommend adjustment (not enough history)
      const result = applyBudgetAdjustment(30000);
      expect(result).toBeNull();
    });

    it('should return adjustment when critical content dropped and verification failed', () => {
      // Record metrics with critical content dropped and failure
      const adjuster = getGlobalAdjuster();

      // Need at least 2 data points
      adjuster.recordMetrics(createBudgetMetrics({ iteration: 1 }));
      adjuster.recordMetrics(
        createBudgetMetrics({
          iteration: 2,
          criticalContentDropped: true,
          verifySuccess: false,
          wasTruncated: true,
        }),
      );

      const adjustment = applyBudgetAdjustment(30000);

      expect(adjustment).not.toBeNull();
      if (adjustment) {
        expect(adjustment.newBudget).toBeGreaterThan(30000);
        expect(adjustment.reason).toBeTruthy();
      }
    });

    it('should return null when adjustment confidence is too low', () => {
      const adjuster = getGlobalAdjuster();

      // Record stable metrics (high success, low truncation)
      for (let i = 0; i < 3; i++) {
        adjuster.recordMetrics(
          createBudgetMetrics({
            iteration: i,
            verifySuccess: true,
            wasTruncated: false,
          }),
        );
      }

      // Should return null when budget is working well
      const adjustment = applyBudgetAdjustment(30000);
      // No adjustment needed when stable
      expect(adjustment).toBeNull();
    });

    it('should provide valid adjustment structure when adjustment is recommended', () => {
      const adjuster = getGlobalAdjuster();

      // Build up history to trigger adjustment
      adjuster.recordMetrics(createBudgetMetrics({ iteration: 1 }));
      adjuster.recordMetrics(
        createBudgetMetrics({
          iteration: 2,
          criticalContentDropped: true,
          verifySuccess: false,
        }),
      );

      const result = applyBudgetAdjustment(30000);

      // Should return a valid adjustment object (not null)
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result).toHaveProperty('newBudget');
        expect(result).toHaveProperty('reason');
        expect(typeof result.newBudget).toBe('number');
        expect(typeof result.reason).toBe('string');
        expect(result.newBudget).toBeGreaterThan(0);
      }
    });
  });

  describe('integration between collect and apply', () => {
    it('should properly flow metrics from collection to adjuster', () => {
      // collectBudgetMetrics returns metrics that can be recorded
      const contextResult = createContextResult({
        truncated: true,
        droppedSections: createDroppedSections({ stagedDiff: true }),
      });

      const metrics = collectBudgetMetrics({
        contextResult,
        verifyResult: createVerifyResult(false),
        iteration: 1,
      });

      // Verify collected metrics are correct
      expect(metrics.wasTruncated).toBe(true);
      expect(metrics.criticalContentDropped).toBe(true);
      expect(metrics.verifySuccess).toBe(false);

      // These metrics can then be recorded to the adjuster
      const adjuster = getGlobalAdjuster();
      adjuster.recordMetrics(metrics);

      // Verify adjuster received the metrics
      const stats = adjuster.getStats();
      expect(stats).not.toBeNull();
      expect(stats?.sampleSize).toBe(1);
    });

    it('should handle multiple iterations with metric collection and recording', () => {
      const adjuster = getGlobalAdjuster();

      // Simulate multiple iterations
      for (let i = 0; i < 3; i++) {
        const contextResult = createContextResult({
          truncated: true,
          droppedSections: createDroppedSections({ stagedDiff: true }),
        });

        // Collect metrics
        const metrics = collectBudgetMetrics({
          contextResult,
          verifyResult: createVerifyResult(false),
          iteration: i,
        });

        // Record to adjuster
        adjuster.recordMetrics(metrics);
      }

      // Verify adjuster has all 3 metrics
      const stats = adjuster.getStats();
      expect(stats?.sampleSize).toBe(3);
      expect(stats?.successRate).toBe(0); // All failed
      expect(stats?.truncationRate).toBe(1); // All truncated
    });
  });

  describe('evaluateBudgetAlert', () => {
    it('returns critical warning when critical content is dropped', () => {
      const alert = evaluateBudgetAlert({
        avgUtilization: 0.7,
        truncationRate: 0.4,
        successRate: 0.7,
        criticalDropRate: 0.2,
        sampleSize: 5,
      });

      expect(alert).not.toBeNull();
      expect(alert?.level).toBe('warn');
      expect(alert?.reason).toContain('critical');
    });

    it('returns truncation warning when truncation rate is high', () => {
      const alert = evaluateBudgetAlert({
        avgUtilization: 0.9,
        truncationRate: 0.8,
        successRate: 0.9,
        criticalDropRate: 0,
        sampleSize: 5,
      });

      expect(alert).not.toBeNull();
      expect(alert?.level).toBe('warn');
      expect(alert?.reason).toContain('truncation');
    });

    it('returns null for healthy stats', () => {
      const alert = evaluateBudgetAlert({
        avgUtilization: 0.75,
        truncationRate: 0.2,
        successRate: 0.9,
        criticalDropRate: 0,
        sampleSize: 5,
      });

      expect(alert).toBeNull();
    });

    it('respects custom alert thresholds', () => {
      const alert = evaluateBudgetAlert(
        {
          avgUtilization: 0.8,
          truncationRate: 0.55,
          successRate: 0.9,
          criticalDropRate: 0,
          sampleSize: 5,
        },
        {
          truncationRateWarn: 0.5,
          criticalDropRateWarn: 0.1,
        },
      );

      expect(alert).not.toBeNull();
      expect(alert?.reason).toContain('truncation');
    });
  });
});
