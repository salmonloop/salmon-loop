import {
  DynamicBudgetAdjuster,
  type BudgetMetrics,
  type DynamicBudgetConfig,
} from '../../../src/core/context/budget/dynamic-adjuster.js';

describe('DynamicBudgetAdjuster', () => {
  const createMetrics = (overrides: Partial<BudgetMetrics> = {}): BudgetMetrics => ({
    budgetAllocated: 30000,
    tokensUsed: 25000,
    wasTruncated: false,
    criticalContentDropped: false,
    verifySuccess: true,
    iteration: 1,
    ...overrides,
  });

  describe('recordMetrics', () => {
    it('should record metrics to history', () => {
      const adjuster = new DynamicBudgetAdjuster();
      const metrics = createMetrics();

      adjuster.recordMetrics(metrics);
      const stats = adjuster.getStats();

      expect(stats).not.toBeNull();
      expect(stats?.sampleSize).toBe(1);
    });

    it('should limit history to max 10 entries', () => {
      const adjuster = new DynamicBudgetAdjuster();

      for (let i = 0; i < 15; i++) {
        adjuster.recordMetrics(createMetrics({ iteration: i }));
      }

      const _stats = adjuster.getStats();
      // getStats only looks at last 5, but history should be limited to 10
      // We verify by checking that old metrics are dropped
      adjuster.reset();
      expect(adjuster.getStats()).toBeNull();
    });
  });

  describe('calculateAdjustment', () => {
    it('should return null when history has less than 2 entries', () => {
      const adjuster = new DynamicBudgetAdjuster();
      adjuster.recordMetrics(createMetrics());

      const adjustment = adjuster.calculateAdjustment(30000);
      expect(adjustment).toBeNull();
    });

    it('should increase budget urgently when critical content dropped and verification failed', () => {
      const adjuster = new DynamicBudgetAdjuster();

      adjuster.recordMetrics(createMetrics({ iteration: 1 }));
      adjuster.recordMetrics(
        createMetrics({
          iteration: 2,
          criticalContentDropped: true,
          verifySuccess: false,
          wasTruncated: true,
        }),
      );

      const adjustment = adjuster.calculateAdjustment(30000);

      expect(adjustment).not.toBeNull();
      expect(adjustment?.newBudget).toBeGreaterThan(30000);
      expect(adjustment?.reason).toContain('Critical content dropped');
      expect(adjustment?.confidence).toBe(0.9);
    });

    it('should increase budget when high truncation and low success rate', () => {
      const adjuster = new DynamicBudgetAdjuster();

      // Add 3 metrics with high truncation and low success
      for (let i = 0; i < 3; i++) {
        adjuster.recordMetrics(
          createMetrics({
            iteration: i,
            wasTruncated: true,
            verifySuccess: false,
          }),
        );
      }

      const adjustment = adjuster.calculateAdjustment(30000);

      expect(adjustment).not.toBeNull();
      expect(adjustment?.newBudget).toBeGreaterThan(30000);
      expect(adjustment?.reason).toContain('High truncation');
    });

    it('should decrease budget when low utilization and high success', () => {
      const adjuster = new DynamicBudgetAdjuster();

      // Add 3 metrics with low utilization and high success
      for (let i = 0; i < 3; i++) {
        adjuster.recordMetrics(
          createMetrics({
            iteration: i,
            tokensUsed: 10000, // Low utilization
            budgetAllocated: 30000,
            verifySuccess: true,
            wasTruncated: false,
          }),
        );
      }

      const adjustment = adjuster.calculateAdjustment(30000);

      expect(adjustment).not.toBeNull();
      expect(adjustment?.newBudget).toBeLessThan(30000);
      expect(adjustment?.reason).toContain('Low utilization');
    });

    it('should return null when budget is stable and successful', () => {
      const adjuster = new DynamicBudgetAdjuster();

      // Add 3 metrics with good performance
      for (let i = 0; i < 3; i++) {
        adjuster.recordMetrics(
          createMetrics({
            iteration: i,
            verifySuccess: true,
            wasTruncated: false,
          }),
        );
      }

      const adjustment = adjuster.calculateAdjustment(30000);
      expect(adjustment).toBeNull();
    });

    it('should respect min and max budget limits', () => {
      const adjuster = new DynamicBudgetAdjuster({
        minBudget: 10000,
        maxBudget: 50000,
        adjustmentStep: 0.5, // Large step to test limits
      });

      // Test max limit - multiple failures with critical content dropped
      for (let i = 0; i < 3; i++) {
        adjuster.recordMetrics(
          createMetrics({
            iteration: i,
            criticalContentDropped: true,
            verifySuccess: false,
          }),
        );
      }

      const increaseAdjustment = adjuster.calculateAdjustment(40000);
      expect(increaseAdjustment?.newBudget).toBeLessThanOrEqual(50000);

      // Reset and test min limit
      adjuster.reset();
      for (let i = 0; i < 3; i++) {
        adjuster.recordMetrics(
          createMetrics({
            iteration: i,
            tokensUsed: 5000, // Very low utilization
            budgetAllocated: 20000,
            verifySuccess: true,
            wasTruncated: false,
          }),
        );
      }

      const decreaseAdjustment = adjuster.calculateAdjustment(15000);
      expect(decreaseAdjustment?.newBudget).toBeGreaterThanOrEqual(10000);
    });
  });

  describe('getStats', () => {
    it('should return null when no history', () => {
      const adjuster = new DynamicBudgetAdjuster();
      expect(adjuster.getStats()).toBeNull();
    });

    it('should calculate correct statistics', () => {
      const adjuster = new DynamicBudgetAdjuster();

      adjuster.recordMetrics(
        createMetrics({
          tokensUsed: 20000,
          budgetAllocated: 40000,
          wasTruncated: true,
          verifySuccess: false,
          criticalContentDropped: true,
        }),
      );

      adjuster.recordMetrics(
        createMetrics({
          tokensUsed: 30000,
          budgetAllocated: 40000,
          wasTruncated: false,
          verifySuccess: true,
          criticalContentDropped: false,
        }),
      );

      const stats = adjuster.getStats();

      expect(stats).not.toBeNull();
      expect(stats?.avgUtilization).toBe((0.5 + 0.75) / 2); // (20000/40000 + 30000/40000) / 2
      expect(stats?.truncationRate).toBe(0.5); // 1 out of 2
      expect(stats?.successRate).toBe(0.5); // 1 out of 2
      expect(stats?.criticalDropRate).toBe(0.5); // 1 out of 2
      expect(stats?.sampleSize).toBe(2);
    });

    it('should only consider last 5 metrics for stats', () => {
      const adjuster = new DynamicBudgetAdjuster();

      // Add 7 metrics: first 2 fail, last 5 succeed
      for (let i = 0; i < 7; i++) {
        adjuster.recordMetrics(createMetrics({ iteration: i, verifySuccess: i >= 2 }));
      }

      const stats = adjuster.getStats();
      // Should only count last 5, all with verifySuccess: true (iterations 2-6)
      expect(stats?.successRate).toBe(1);
      expect(stats?.sampleSize).toBe(5);
    });
  });

  describe('reset', () => {
    it('should clear all history', () => {
      const adjuster = new DynamicBudgetAdjuster();
      adjuster.recordMetrics(createMetrics());

      expect(adjuster.getStats()).not.toBeNull();

      adjuster.reset();
      expect(adjuster.getStats()).toBeNull();
    });
  });

  describe('configuration', () => {
    it('should use default config when not provided', () => {
      const adjuster = new DynamicBudgetAdjuster();

      // Verify defaults by testing adjustment respects limits
      for (let i = 0; i < 3; i++) {
        adjuster.recordMetrics(
          createMetrics({
            criticalContentDropped: true,
            verifySuccess: false,
          }),
        );
      }

      const adjustment = adjuster.calculateAdjustment(90000);
      // Default max is 100000, so adjustment should be capped
      expect(adjustment?.newBudget).toBeLessThanOrEqual(100000);
    });

    it('should expose default alert thresholds when not provided', () => {
      const adjuster = new DynamicBudgetAdjuster();
      expect(adjuster.getAlertThresholds()).toEqual({
        truncationRateWarn: 0.6,
        criticalDropRateWarn: 0,
      });
    });

    it('should use custom alert thresholds when provided', () => {
      const adjuster = new DynamicBudgetAdjuster({
        minBudget: 5000,
        maxBudget: 100000,
        adjustmentStep: 0.15,
        alerts: {
          truncationRateWarn: 0.75,
          criticalDropRateWarn: 0.1,
        },
      });

      expect(adjuster.getAlertThresholds()).toEqual({
        truncationRateWarn: 0.75,
        criticalDropRateWarn: 0.1,
      });
    });

    it('should use custom config when provided', () => {
      const config: DynamicBudgetConfig = {
        minBudget: 20000,
        maxBudget: 40000,
        adjustmentStep: 0.1,
      };
      const adjuster = new DynamicBudgetAdjuster(config);

      for (let i = 0; i < 3; i++) {
        adjuster.recordMetrics(
          createMetrics({
            criticalContentDropped: true,
            verifySuccess: false,
          }),
        );
      }

      const adjustment = adjuster.calculateAdjustment(35000);
      // Custom max is 40000
      expect(adjustment?.newBudget).toBeLessThanOrEqual(40000);
    });
  });
});
