/**
 * Adaptive Context Budget Module.
 *
 * Implements priority-layered budget resolution:
 * 1. Memory cache (transparent acceleration layer)
 * 2. User configuration (highest authority)
 * 3. API query (real-time authority) - placeholder for future
 * 4. Static config library (MODEL_CONTEXT_CONFIG)
 * 5. Conservative default values
 *
 * Design Principles:
 * - SSOT: Single source of truth for budget configuration
 * - Extensibility: Easy to add new models/providers
 * - Performance: Memory cache for hot path
 * - User override: User config takes precedence
 */

import type { ModelFamily } from './types.js';

/**
 * Model context configuration.
 * Contains budget limits for a specific model.
 */
export interface ModelContextConfig {
  /** Model family identifier */
  modelFamily: ModelFamily | string;

  /** Maximum context window (tokens) */
  maxContextWindow: number;

  /** Recommended context budget for prompts (tokens) */
  recommendedBudget: number;

  /** Minimum context budget to prevent over-shrinking */
  minBudget: number;

  /** Maximum primary content tokens */
  maxPrimaryTokens: number;

  /** Output buffer reserved for model response */
  outputBuffer: number;

  /** Whether model supports caching (for future use) */
  supportsCaching?: boolean;

  /** Provider name for categorization */
  provider: string;
}

/**
 * User configuration override.
 */
export interface UserBudgetConfig {
  /** Override recommended budget */
  recommendedBudget?: number;

  /** Override minimum budget */
  minBudget?: number;

  /** Override maximum primary tokens */
  maxPrimaryTokens?: number;

  /** Override output buffer */
  outputBuffer?: number;
}

/**
 * Static model context configuration library.
 * Contains known model configurations.
 *
 * Add new models here when they become available.
 * Budget values are conservative estimates based on:
 * - Context window size
 * - Output buffer requirements
 * - Safety margins
 */
export const MODEL_CONTEXT_CONFIG: Record<string, ModelContextConfig> = {
  // OpenAI GPT-4 family
  'openai-gpt4': {
    modelFamily: 'openai-gpt4',
    maxContextWindow: 128000,
    recommendedBudget: 30000,
    minBudget: 5000,
    maxPrimaryTokens: 12000,
    outputBuffer: 4096,
    supportsCaching: true,
    provider: 'openai',
  },
  'openai-gpt4-turbo': {
    modelFamily: 'openai-gpt4',
    maxContextWindow: 128000,
    recommendedBudget: 30000,
    minBudget: 5000,
    maxPrimaryTokens: 12000,
    outputBuffer: 4096,
    supportsCaching: true,
    provider: 'openai',
  },
  'openai-gpt4o': {
    modelFamily: 'openai-gpt4o',
    maxContextWindow: 128000,
    recommendedBudget: 30000,
    minBudget: 5000,
    maxPrimaryTokens: 12000,
    outputBuffer: 4096,
    supportsCaching: true,
    provider: 'openai',
  },
  'openai-gpt4o-mini': {
    modelFamily: 'openai-gpt4o',
    maxContextWindow: 128000,
    recommendedBudget: 25000,
    minBudget: 4000,
    maxPrimaryTokens: 10000,
    outputBuffer: 4096,
    supportsCaching: true,
    provider: 'openai',
  },
  'openai-gpt35-turbo': {
    modelFamily: 'openai-gpt35',
    maxContextWindow: 16385,
    recommendedBudget: 12000,
    minBudget: 3000,
    maxPrimaryTokens: 6000,
    outputBuffer: 4096,
    provider: 'openai',
  },

  // Anthropic Claude family
  'anthropic-claude': {
    modelFamily: 'anthropic-claude',
    maxContextWindow: 200000,
    recommendedBudget: 50000,
    minBudget: 8000,
    maxPrimaryTokens: 20000,
    outputBuffer: 8192,
    supportsCaching: true,
    provider: 'anthropic',
  },
  'anthropic-claude-sonnet': {
    modelFamily: 'anthropic-claude',
    maxContextWindow: 200000,
    recommendedBudget: 40000,
    minBudget: 6000,
    maxPrimaryTokens: 15000,
    outputBuffer: 8192,
    supportsCaching: true,
    provider: 'anthropic',
  },
  'anthropic-claude-haiku': {
    modelFamily: 'anthropic-claude',
    maxContextWindow: 200000,
    recommendedBudget: 30000,
    minBudget: 5000,
    maxPrimaryTokens: 12000,
    outputBuffer: 8192,
    supportsCaching: true,
    provider: 'anthropic',
  },

  // Generic/fallback configurations
  'default-small': {
    modelFamily: 'default',
    maxContextWindow: 8000,
    recommendedBudget: 4000,
    minBudget: 1500,
    maxPrimaryTokens: 3000,
    outputBuffer: 2048,
    provider: 'generic',
  },
  'default-medium': {
    modelFamily: 'default',
    maxContextWindow: 32000,
    recommendedBudget: 15000,
    minBudget: 4000,
    maxPrimaryTokens: 8000,
    outputBuffer: 4096,
    provider: 'generic',
  },
  'default-large': {
    modelFamily: 'default',
    maxContextWindow: 128000,
    recommendedBudget: 30000,
    minBudget: 5000,
    maxPrimaryTokens: 12000,
    outputBuffer: 4096,
    provider: 'generic',
  },
};

/**
 * Model alias map for flexible model name matching.
 * Maps various model identifiers to canonical names.
 */
const MODEL_ALIASES: Record<string, string> = {
  // OpenAI aliases
  'gpt-4': 'openai-gpt4',
  'gpt-4-turbo': 'openai-gpt4-turbo',
  'gpt-4-turbo-preview': 'openai-gpt4-turbo',
  'gpt-4o': 'openai-gpt4o',
  'gpt-4o-mini': 'openai-gpt4o-mini',
  'gpt-3.5-turbo': 'openai-gpt35-turbo',
  'gpt-3.5': 'openai-gpt35-turbo',

  // Anthropic aliases
  claude: 'anthropic-claude',
  'claude-3': 'anthropic-claude',
  'claude-3-opus': 'anthropic-claude',
  'claude-3-sonnet': 'anthropic-claude-sonnet',
  'claude-3-haiku': 'anthropic-claude-haiku',
  'claude-3.5-sonnet': 'anthropic-claude-sonnet',
  'claude-3.5-haiku': 'anthropic-claude-haiku',

  // Default aliases
  default: 'default-medium',
  unknown: 'default-medium',
};

/**
 * Memory cache entry for budget lookups.
 */
interface CacheEntry {
  config: ModelContextConfig;
  timestamp: number;
}

/**
 * Adaptive budget calculator with priority-layered resolution.
 *
 * Resolution priority:
 * 1. Memory cache (transparent acceleration)
 * 2. User configuration (highest authority)
 * 3. API query (real-time authority) - future extension
 * 4. Static config library (MODEL_CONTEXT_CONFIG)
 * 5. Conservative default values
 */
export class AdaptiveBudgetCalculator {
  private memoryCache = new Map<string, CacheEntry>();
  private userConfig: UserBudgetConfig | null = null;
  private readonly cacheTTL = 60000; // 1 minute TTL for memory cache

  /**
   * Set user configuration override.
   * User config has highest authority.
   */
  setUserConfig(config: UserBudgetConfig | null): void {
    this.userConfig = config;
    // Clear cache when user config changes
    this.memoryCache.clear();
  }

  /**
   * Get user configuration.
   */
  getUserConfig(): UserBudgetConfig | null {
    return this.userConfig;
  }

  /**
   * Resolve model context configuration.
   *
   * @param modelId - Model identifier (e.g., 'gpt-4o', 'claude-3-sonnet')
   * @returns Resolved configuration with user overrides applied
   */
  resolveConfig(modelId: string): ModelContextConfig {
    const normalizedId = this.normalizeModelId(modelId);

    // 1. Check memory cache
    const cached = this.getFromCache(normalizedId);
    if (cached) {
      return this.applyUserOverride(cached);
    }

    // 2. Check user config for model-specific override (future: per-model user config)

    // 3. API query placeholder (future extension point)
    // const apiConfig = await this.fetchFromAPI(normalizedId);

    // 4. Static config library
    const staticConfig = MODEL_CONTEXT_CONFIG[normalizedId];
    if (staticConfig) {
      this.setCache(normalizedId, staticConfig);
      return this.applyUserOverride(staticConfig);
    }

    // 5. Conservative default
    const defaultConfig = this.getDefaultConfig(modelId);
    this.setCache(normalizedId, defaultConfig);
    return this.applyUserOverride(defaultConfig);
  }

  /**
   * Get recommended budget for model.
   */
  getRecommendedBudget(modelId: string): number {
    const config = this.resolveConfig(modelId);
    return config.recommendedBudget;
  }

  /**
   * Get minimum budget for model.
   */
  getMinBudget(modelId: string): number {
    const config = this.resolveConfig(modelId);
    return config.minBudget;
  }

  /**
   * Get maximum primary tokens for model.
   */
  getMaxPrimaryTokens(modelId: string): number {
    const config = this.resolveConfig(modelId);
    return config.maxPrimaryTokens;
  }

  /**
   * Clear memory cache.
   */
  clearCache(): void {
    this.memoryCache.clear();
  }

  /**
   * Normalize model ID to canonical form.
   */
  private normalizeModelId(modelId: string): string {
    const lowercased = modelId.toLowerCase().trim();

    // Check alias map
    if (MODEL_ALIASES[lowercased]) {
      return MODEL_ALIASES[lowercased];
    }

    // Check if it exists in static config
    if (MODEL_CONTEXT_CONFIG[lowercased]) {
      return lowercased;
    }

    // Try partial matching for flexibility
    for (const [alias, canonical] of Object.entries(MODEL_ALIASES)) {
      if (lowercased.includes(alias) || alias.includes(lowercased)) {
        return canonical;
      }
    }

    // Return as-is, will fall back to default
    return lowercased;
  }

  /**
   * Get from memory cache.
   */
  private getFromCache(modelId: string): ModelContextConfig | null {
    const entry = this.memoryCache.get(modelId);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > this.cacheTTL) {
      this.memoryCache.delete(modelId);
      return null;
    }

    return entry.config;
  }

  /**
   * Set memory cache.
   */
  private setCache(modelId: string, config: ModelContextConfig): void {
    this.memoryCache.set(modelId, {
      config,
      timestamp: Date.now(),
    });
  }

  /**
   * Apply user override to config.
   */
  private applyUserOverride(config: ModelContextConfig): ModelContextConfig {
    if (!this.userConfig) return config;

    return {
      ...config,
      recommendedBudget: this.userConfig.recommendedBudget ?? config.recommendedBudget,
      minBudget: this.userConfig.minBudget ?? config.minBudget,
      maxPrimaryTokens: this.userConfig.maxPrimaryTokens ?? config.maxPrimaryTokens,
      outputBuffer: this.userConfig.outputBuffer ?? config.outputBuffer,
    };
  }

  /**
   * Get default config for unknown models.
   * Uses conservative values from LIMITS.
   */
  private getDefaultConfig(modelId: string): ModelContextConfig {
    // Determine default tier based on model name hints
    const lowercased = modelId.toLowerCase();

    if (
      lowercased.includes('mini') ||
      lowercased.includes('small') ||
      lowercased.includes('haiku')
    ) {
      return MODEL_CONTEXT_CONFIG['default-small'];
    }

    if (
      lowercased.includes('large') ||
      lowercased.includes('opus') ||
      lowercased.includes('claude')
    ) {
      return MODEL_CONTEXT_CONFIG['default-large'];
    }

    // Default to medium
    return MODEL_CONTEXT_CONFIG['default-medium'];
  }
}

/**
 * Global adaptive budget calculator instance.
 * Singleton for consistent budget resolution across the application.
 */
let globalInstance: AdaptiveBudgetCalculator | null = null;

/**
 * Get the global adaptive budget calculator instance.
 */
export function getAdaptiveBudgetCalculator(): AdaptiveBudgetCalculator {
  if (!globalInstance) {
    globalInstance = new AdaptiveBudgetCalculator();
  }
  return globalInstance;
}

/**
 * Reset the global instance (for testing).
 */
export function resetAdaptiveBudgetCalculator(): void {
  globalInstance = null;
}

/**
 * Convenience function to get recommended budget.
 */
export function getModelRecommendedBudget(modelId: string): number {
  return getAdaptiveBudgetCalculator().getRecommendedBudget(modelId);
}

/**
 * Convenience function to get minimum budget.
 */
export function getModelMinBudget(modelId: string): number {
  return getAdaptiveBudgetCalculator().getMinBudget(modelId);
}

/**
 * Convenience function to get max primary tokens.
 */
export function getModelMaxPrimaryTokens(modelId: string): number {
  return getAdaptiveBudgetCalculator().getMaxPrimaryTokens(modelId);
}
