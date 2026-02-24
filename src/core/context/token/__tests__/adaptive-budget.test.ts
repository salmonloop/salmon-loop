/**
 * Tests for Adaptive Budget Calculator.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import {
  AdaptiveBudgetCalculator,
  MODEL_CONTEXT_CONFIG,
  getAdaptiveBudgetCalculator,
  resetAdaptiveBudgetCalculator,
  getModelRecommendedBudget,
  getModelMinBudget,
  getModelMaxPrimaryTokens,
  type UserBudgetConfig,
} from '../adaptive-budget.js';

describe('AdaptiveBudgetCalculator', () => {
  let calculator: AdaptiveBudgetCalculator;

  beforeEach(() => {
    calculator = new AdaptiveBudgetCalculator();
    resetAdaptiveBudgetCalculator();
  });

  afterEach(() => {
    resetAdaptiveBudgetCalculator();
  });

  describe('resolveConfig', () => {
    it('should resolve config for known OpenAI models', () => {
      const config = calculator.resolveConfig('gpt-4o');

      expect(config.modelFamily).toBe('openai-gpt4o');
      expect(config.recommendedBudget).toBeGreaterThan(0);
      expect(config.minBudget).toBeGreaterThan(0);
      expect(config.provider).toBe('openai');
    });

    it('should resolve config for known Anthropic models', () => {
      const config = calculator.resolveConfig('claude-3-sonnet');

      expect(config.modelFamily).toBe('anthropic-claude');
      expect(config.recommendedBudget).toBeGreaterThan(0);
      expect(config.provider).toBe('anthropic');
    });

    it('should handle model aliases', () => {
      const gpt4Config = calculator.resolveConfig('gpt-4');
      const gpt4FullConfig = calculator.resolveConfig('openai-gpt4');

      expect(gpt4Config.modelFamily).toBe(gpt4FullConfig.modelFamily);
    });

    it('should return default config for unknown models', () => {
      const config = calculator.resolveConfig('unknown-model-xyz');

      expect(config.modelFamily).toBe('default');
      expect(config.recommendedBudget).toBeGreaterThan(0);
    });

    it('should return small default for mini/small/haiku models', () => {
      const miniConfig = calculator.resolveConfig('some-mini-model');
      const defaultConfig = calculator.resolveConfig('some-random-model');

      expect(miniConfig.recommendedBudget).toBeLessThan(defaultConfig.recommendedBudget);
    });

    it('should return large default for large/opus/claude models', () => {
      const largeConfig = calculator.resolveConfig('some-large-model');
      const mediumConfig = calculator.resolveConfig('some-random-model');

      expect(largeConfig.recommendedBudget).toBeGreaterThanOrEqual(mediumConfig.recommendedBudget);
    });
  });

  describe('memory cache', () => {
    it('should cache resolved configs', () => {
      // First call
      const config1 = calculator.resolveConfig('gpt-4o');

      // Second call should hit cache
      const config2 = calculator.resolveConfig('gpt-4o');

      expect(config1).toEqual(config2);
    });

    it('should clear cache', () => {
      calculator.resolveConfig('gpt-4o');
      calculator.clearCache();

      // Cache should be empty, but result should still be valid
      const config = calculator.resolveConfig('gpt-4o');
      expect(config.modelFamily).toBe('openai-gpt4o');
    });
  });

  describe('user configuration', () => {
    it('should apply user config overrides', () => {
      const userConfig: UserBudgetConfig = {
        recommendedBudget: 50000,
        minBudget: 10000,
      };

      calculator.setUserConfig(userConfig);
      const config = calculator.resolveConfig('gpt-4o');

      expect(config.recommendedBudget).toBe(50000);
      expect(config.minBudget).toBe(10000);
      // Should keep other values from static config
      expect(config.provider).toBe('openai');
    });

    it('should clear user config', () => {
      const userConfig: UserBudgetConfig = {
        recommendedBudget: 50000,
      };

      calculator.setUserConfig(userConfig);
      let config = calculator.resolveConfig('gpt-4o');
      expect(config.recommendedBudget).toBe(50000);

      calculator.setUserConfig(null);
      config = calculator.resolveConfig('gpt-4o');
      expect(config.recommendedBudget).toBe(MODEL_CONTEXT_CONFIG['openai-gpt4o'].recommendedBudget);
    });

    it('should preserve undefined override values', () => {
      const userConfig: UserBudgetConfig = {
        recommendedBudget: 50000,
        // minBudget not set
      };

      calculator.setUserConfig(userConfig);
      const config = calculator.resolveConfig('gpt-4o');

      expect(config.recommendedBudget).toBe(50000);
      expect(config.minBudget).toBe(MODEL_CONTEXT_CONFIG['openai-gpt4o'].minBudget);
    });
  });

  describe('convenience functions', () => {
    it('should get recommended budget', () => {
      const budget = getModelRecommendedBudget('gpt-4o');
      expect(budget).toBe(MODEL_CONTEXT_CONFIG['openai-gpt4o'].recommendedBudget);
    });

    it('should get min budget', () => {
      const budget = getModelMinBudget('gpt-4o');
      expect(budget).toBe(MODEL_CONTEXT_CONFIG['openai-gpt4o'].minBudget);
    });

    it('should get max primary tokens', () => {
      const tokens = getModelMaxPrimaryTokens('gpt-4o');
      expect(tokens).toBe(MODEL_CONTEXT_CONFIG['openai-gpt4o'].maxPrimaryTokens);
    });
  });

  describe('global instance', () => {
    it('should return singleton instance', () => {
      const instance1 = getAdaptiveBudgetCalculator();
      const instance2 = getAdaptiveBudgetCalculator();

      expect(instance1).toBe(instance2);
    });

    it('should reset global instance', () => {
      const instance1 = getAdaptiveBudgetCalculator();
      resetAdaptiveBudgetCalculator();
      const instance2 = getAdaptiveBudgetCalculator();

      expect(instance1).not.toBe(instance2);
    });
  });
});

describe('MODEL_CONTEXT_CONFIG', () => {
  it('should have valid config for all entries', () => {
    for (const [key, config] of Object.entries(MODEL_CONTEXT_CONFIG)) {
      expect(config.modelFamily, `${key}: modelFamily should be defined`).toBeDefined();
      expect(
        config.maxContextWindow,
        `${key}: maxContextWindow should be positive`,
      ).toBeGreaterThan(0);
      expect(
        config.recommendedBudget,
        `${key}: recommendedBudget should be positive`,
      ).toBeGreaterThan(0);
      expect(config.minBudget, `${key}: minBudget should be positive`).toBeGreaterThan(0);
      expect(
        config.maxPrimaryTokens,
        `${key}: maxPrimaryTokens should be positive`,
      ).toBeGreaterThan(0);
      expect(config.outputBuffer, `${key}: outputBuffer should be positive`).toBeGreaterThan(0);
      expect(config.provider, `${key}: provider should be defined`).toBeDefined();
    }
  });

  it('should have recommendedBudget < maxContextWindow', () => {
    for (const [key, config] of Object.entries(MODEL_CONTEXT_CONFIG)) {
      expect(
        config.recommendedBudget,
        `${key}: recommendedBudget should be less than maxContextWindow`,
      ).toBeLessThan(config.maxContextWindow);
    }
  });

  it('should have minBudget < recommendedBudget', () => {
    for (const [key, config] of Object.entries(MODEL_CONTEXT_CONFIG)) {
      expect(
        config.minBudget,
        `${key}: minBudget should be less than recommendedBudget`,
      ).toBeLessThan(config.recommendedBudget);
    }
  });
});
