/**
 * Token budget calculator for context management.
 *
 * Provides token-based budget calculation as a replacement for character-based estimation.
 * Designed for gradual migration from character-based to token-based budgeting.
 *
 * Supports model-adaptive budget via AdaptiveBudgetCalculator integration.
 */

import { LIMITS } from '../../config/limits.js';
import type { Context, RelatedFileContext, RipgrepResult } from '../../types/index.js';

import {
  getAdaptiveBudgetCalculator,
  type ModelContextConfig,
  type UserBudgetConfig,
} from './adaptive-budget.js';

import { TokenCounter } from './index.js';

/**
 * Budget mode for context calculation.
 */
export type BudgetMode = 'token' | 'char';

/**
 * Token budget configuration.
 */
export interface TokenBudgetConfig {
  /** Budget mode: 'token' for accurate, 'char' for legacy */
  mode: BudgetMode;

  /** Default token budget (approx. 7500 tokens for 30k chars) */
  defaultTokenBudget: number;

  /** Minimum token budget to prevent over-shrinking */
  minTokenBudget: number;
}

/**
 * Default token budget configuration.
 */
export const DEFAULT_TOKEN_BUDGET_CONFIG: TokenBudgetConfig = {
  mode: 'token',
  defaultTokenBudget: LIMITS.maxContextTokens,
  minTokenBudget: LIMITS.minContextTokens,
};

/**
 * Section-wise token counts.
 */
export interface ContextSectionTokens {
  primary: number;
  relatedFiles: number;
  rgSnippets: number;
  diffs: number;
  total: number;
}

/**
 * Token budget calculator.
 *
 * Provides methods for calculating token counts of context components.
 * Supports model-adaptive budget via setModel().
 */
export class TokenBudgetCalculator {
  private tokenCounter: TokenCounter | null = null;
  private initialized = false;
  private modelId: string | null = null;
  private modelConfig: ModelContextConfig | null = null;

  constructor(private config: TokenBudgetConfig = DEFAULT_TOKEN_BUDGET_CONFIG) {}

  /**
   * Initialize the calculator (loads tiktoken).
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.config.mode === 'token') {
      this.tokenCounter = new TokenCounter();
      await this.tokenCounter.initialize();
    }

    this.initialized = true;
  }

  /**
   * Dispose resources.
   */
  dispose(): void {
    if (this.tokenCounter) {
      this.tokenCounter.dispose();
      this.tokenCounter = null;
    }
    this.initialized = false;
    this.modelId = null;
    this.modelConfig = null;
  }

  /**
   * Set model for adaptive budget calculation.
   * This updates budget limits based on model capabilities.
   */
  setModel(modelId: string): void {
    this.modelId = modelId;
    this.modelConfig = getAdaptiveBudgetCalculator().resolveConfig(modelId);
  }

  /**
   * Get current model ID.
   */
  getModel(): string | null {
    return this.modelId;
  }

  /**
   * Get current model context config.
   */
  getModelConfig(): ModelContextConfig | null {
    return this.modelConfig;
  }

  /**
   * Set user budget configuration override.
   */
  setUserConfig(config: UserBudgetConfig | null): void {
    getAdaptiveBudgetCalculator().setUserConfig(config);
    // Refresh model config if model is set
    if (this.modelId) {
      this.modelConfig = getAdaptiveBudgetCalculator().resolveConfig(this.modelId);
    }
  }

  /**
   * Get current budget mode.
   */
  get mode(): BudgetMode {
    return this.config.mode;
  }

  /**
   * Count tokens/chars for a string based on current mode.
   */
  count(text: string): number {
    if (this.config.mode === 'char') {
      return text.length;
    }

    if (!this.tokenCounter) {
      // Fallback to char estimation if not initialized
      return Math.ceil(text.length / 4);
    }

    return this.tokenCounter.count(text);
  }

  /**
   * Calculate total tokens for context.
   */
  calculateTotalTokens(context: Context): number {
    const primary = this.count(context.primaryText ?? '');
    const related =
      context.relatedFiles?.reduce((sum, file) => sum + this.count(file.content ?? ''), 0) ?? 0;
    const snippets = context.rgSnippets.reduce(
      (sum, snippet) => sum + this.count(snippet.content ?? ''),
      0,
    );
    const diff =
      this.count(context.gitDiff ?? '') +
      this.count(context.stagedDiff ?? '') +
      this.count(context.unstagedDiff ?? '') +
      this.count(context.untrackedDiff ?? '');

    return primary + related + snippets + diff;
  }

  /**
   * Calculate section-wise tokens.
   */
  calculateSectionTokens(context: Context): ContextSectionTokens {
    const primary = this.count(context.primaryText ?? '');
    const relatedFiles =
      context.relatedFiles?.reduce((sum, f) => sum + this.count(f.content ?? ''), 0) ?? 0;
    const rgSnippets = context.rgSnippets.reduce((sum, s) => sum + this.count(s.content ?? ''), 0);
    const diffs =
      this.count(context.gitDiff ?? '') +
      this.count(context.stagedDiff ?? '') +
      this.count(context.unstagedDiff ?? '') +
      this.count(context.untrackedDiff ?? '');

    return {
      primary,
      relatedFiles,
      rgSnippets,
      diffs,
      total: primary + relatedFiles + rgSnippets + diffs,
    };
  }

  /**
   * Calculate tokens for a file.
   */
  calculateFileTokens(file: RelatedFileContext): number {
    return this.count(file.content ?? '');
  }

  /**
   * Calculate tokens for a snippet.
   */
  calculateSnippetTokens(snippet: RipgrepResult): number {
    return this.count(snippet.content ?? '');
  }

  /**
   * Calculate tokens for diffs.
   */
  calculateDiffTokens(context: Context): number {
    return (
      this.count(context.gitDiff ?? '') +
      this.count(context.stagedDiff ?? '') +
      this.count(context.unstagedDiff ?? '') +
      this.count(context.untrackedDiff ?? '')
    );
  }

  /**
   * Get default budget for current mode.
   * If model is set, returns model-specific recommended budget.
   */
  getDefaultBudget(): number {
    if (this.modelConfig) {
      return this.modelConfig.recommendedBudget;
    }
    return this.config.defaultTokenBudget;
  }

  /**
   * Get minimum budget for current mode.
   * If model is set, returns model-specific minimum budget.
   */
  getMinBudget(): number {
    if (this.modelConfig) {
      return this.modelConfig.minBudget;
    }
    return this.config.minTokenBudget;
  }

  /**
   * Get maximum primary tokens.
   * If model is set, returns model-specific max primary tokens.
   */
  getMaxPrimaryTokens(): number {
    if (this.modelConfig) {
      return this.modelConfig.maxPrimaryTokens;
    }
    return this.config.defaultTokenBudget;
  }

  /**
   * Get output buffer for current model.
   */
  getOutputBuffer(): number {
    if (this.modelConfig) {
      return this.modelConfig.outputBuffer;
    }
    return 4096; // Default output buffer
  }

  /**
   * Convert token budget to char estimate (for backwards compatibility).
   */
  tokenToCharEstimate(tokens: number): number {
    return tokens * 4; // Rough estimate: 1 token ≈ 4 chars
  }

  /**
   * Convert char budget to token estimate.
   */
  charToTokenEstimate(chars: number): number {
    return Math.ceil(chars / 4);
  }
}
