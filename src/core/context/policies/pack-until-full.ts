/**
 * Pack-Until-Full budget policy.
 *
 * Packs context items by priority until budget is exhausted.
 * Supports both character-based (legacy) and token-based (accurate) budgeting.
 */

import { text } from '../../../locales/index.js';
import { LIMITS } from '../../config/limits.js';
import type { Context, RelatedFileContext, RipgrepResult } from '../../types/index.js';
import { normalizePath } from '../../utils/path.js';
import { TokenBudgetCalculator } from '../token/token-budget.js';

export interface BudgetResult {
  context: Context;
  truncated: boolean;
}

/**
 * Budget calculator interface for dependency injection.
 * Allows using either char-based or token-based calculation.
 */
export interface IBudgetCalculator {
  count(text: string): number;
  calculateTotalTokens(context: Context): number;
  calculateDiffTokens(context: Context): number;
  calculateFileTokens(file: RelatedFileContext): number;
  calculateSnippetTokens(snippet: RipgrepResult): number;
  getDefaultBudget(): number;
  getMinBudget(): number;
}

/**
 * Character-based budget calculator (legacy).
 */
class CharBudgetCalculator implements IBudgetCalculator {
  count(text: string): number {
    return text.length;
  }

  calculateTotalTokens(context: Context): number {
    const primary = context.primaryText?.length ?? 0;
    const related =
      context.relatedFiles?.reduce((sum, file) => sum + (file.content?.length ?? 0), 0) ?? 0;
    const snippets = context.rgSnippets.reduce(
      (sum, snippet) => sum + (snippet.content?.length ?? 0),
      0,
    );
    const diff =
      (context.gitDiff?.length ?? 0) +
      (context.stagedDiff?.length ?? 0) +
      (context.unstagedDiff?.length ?? 0) +
      (context.untrackedDiff?.length ?? 0);
    return primary + related + snippets + diff;
  }

  calculateDiffTokens(context: Context): number {
    return (
      (context.gitDiff?.length ?? 0) +
      (context.stagedDiff?.length ?? 0) +
      (context.unstagedDiff?.length ?? 0) +
      (context.untrackedDiff?.length ?? 0)
    );
  }

  calculateFileTokens(file: RelatedFileContext): number {
    return file.content?.length ?? 0;
  }

  calculateSnippetTokens(snippet: RipgrepResult): number {
    return snippet.content?.length ?? 0;
  }

  getDefaultBudget(): number {
    return LIMITS.maxContextChars;
  }

  getMinBudget(): number {
    return LIMITS.minContextChars;
  }
}

/**
 * Adapter for TokenBudgetCalculator.
 */
class TokenBudgetAdapter implements IBudgetCalculator {
  constructor(private calculator: TokenBudgetCalculator) {}

  count(text: string): number {
    return this.calculator.count(text);
  }

  calculateTotalTokens(context: Context): number {
    return this.calculator.calculateTotalTokens(context);
  }

  calculateDiffTokens(context: Context): number {
    return this.calculator.calculateDiffTokens(context);
  }

  calculateFileTokens(file: RelatedFileContext): number {
    return this.calculator.calculateFileTokens(file);
  }

  calculateSnippetTokens(snippet: RipgrepResult): number {
    return this.calculator.calculateSnippetTokens(snippet);
  }

  getDefaultBudget(): number {
    return this.calculator.getDefaultBudget();
  }

  getMinBudget(): number {
    return this.calculator.getMinBudget();
  }
}

/**
 * Create budget calculator based on mode.
 */
export function createBudgetCalculator(tokenCalculator?: TokenBudgetCalculator): IBudgetCalculator {
  if (tokenCalculator) {
    return new TokenBudgetAdapter(tokenCalculator);
  }
  return new CharBudgetCalculator();
}

/**
 * Budget allocation strategy with partitioned quotas.
 * Ensures critical content always has guaranteed space.
 */

function truncateWithMarker(
  content: string,
  maxUnits: number,
  minUnits: number,
  calculator: IBudgetCalculator,
): string | undefined {
  if (maxUnits < minUnits) return undefined;
  const contentUnits = calculator.count(content);
  if (contentUnits <= maxUnits) return content;

  const marker = `\n${text.context.contentTruncated}\n`;
  const markerUnits = calculator.count(marker);
  const maxSliceUnits = Math.max(0, maxUnits - markerUnits);

  if (maxSliceUnits < minUnits) {
    // Simple truncation without marker
    const ratio = maxUnits / contentUnits;
    const sliceLen = Math.floor(content.length * ratio);
    return content.substring(0, sliceLen);
  }

  const ratio = maxSliceUnits / contentUnits;
  const sliceLen = Math.floor(content.length * ratio);
  return `${content.substring(0, sliceLen)}${marker}`;
}

function buildTargetSet(context: Context): Set<string> {
  const set = new Set<string>();
  for (const t of context.targets ?? []) {
    const key = normalizePath(t.path).replace(/^(\.\/|\/)+/, '');
    if (key) set.add(key);
  }
  if (context.primaryFile) {
    const key = normalizePath(context.primaryFile).replace(/^(\.\/|\/)+/, '');
    if (key) set.add(key);
  }
  return set;
}

/**
 * Singleton token calculator for default usage.
 * Initialized lazily on first use.
 */
let defaultTokenCalculator: TokenBudgetCalculator | null = null;
let initializationPromise: Promise<void> | null = null;
let useTokenBudget = true; // Default to true

/**
 * Set whether to use token budget by default.
 * Can be controlled via config.context.useTokenBudget.
 */
export function setUseTokenBudget(enabled: boolean): void {
  useTokenBudget = enabled;
}

/**
 * Set model for adaptive budget calculation.
 * This updates budget limits based on model capabilities.
 */
export function setDefaultModel(modelId: string): void {
  if (defaultTokenCalculator) {
    defaultTokenCalculator.setModel(modelId);
  }
}

/**
 * Get or create the default token calculator.
 * Initializes on first call.
 */
async function getDefaultTokenCalculator(): Promise<TokenBudgetCalculator> {
  if (defaultTokenCalculator) {
    return defaultTokenCalculator;
  }

  if (!initializationPromise) {
    initializationPromise = (async () => {
      defaultTokenCalculator = new TokenBudgetCalculator();
      await defaultTokenCalculator.initialize();
    })();
  }

  await initializationPromise;
  return defaultTokenCalculator!;
}

/**
 * Create default budget calculator.
 * Uses token-based calculation by default for accuracy.
 * Falls back to char-based if token calculator initialization fails or disabled.
 */
function createDefaultCalculator(): IBudgetCalculator {
  // If token budget is disabled, use char calculator
  if (!useTokenBudget) {
    return new CharBudgetCalculator();
  }

  // Return a lazy-initializing adapter
  return {
    count(text: string): number {
      if (defaultTokenCalculator?.mode === 'token') {
        return defaultTokenCalculator.count(text);
      }
      // Fallback to char-based estimation
      return Math.ceil(text.length / 4);
    },
    calculateTotalTokens(context: Context): number {
      if (defaultTokenCalculator?.mode === 'token') {
        return defaultTokenCalculator.calculateTotalTokens(context);
      }
      return new CharBudgetCalculator().calculateTotalTokens(context);
    },
    calculateDiffTokens(context: Context): number {
      if (defaultTokenCalculator?.mode === 'token') {
        return defaultTokenCalculator.calculateDiffTokens(context);
      }
      return new CharBudgetCalculator().calculateDiffTokens(context);
    },
    calculateFileTokens(file: RelatedFileContext): number {
      if (defaultTokenCalculator?.mode === 'token') {
        return defaultTokenCalculator.calculateFileTokens(file);
      }
      return file.content?.length ?? 0;
    },
    calculateSnippetTokens(snippet: RipgrepResult): number {
      if (defaultTokenCalculator?.mode === 'token') {
        return defaultTokenCalculator.calculateSnippetTokens(snippet);
      }
      return snippet.content?.length ?? 0;
    },
    getDefaultBudget(): number {
      if (defaultTokenCalculator?.mode === 'token') {
        return defaultTokenCalculator.getDefaultBudget();
      }
      return LIMITS.maxContextChars;
    },
    getMinBudget(): number {
      if (defaultTokenCalculator?.mode === 'token') {
        return defaultTokenCalculator.getMinBudget();
      }
      return LIMITS.minContextChars;
    },
  };
}

/**
 * Initialize the default token calculator.
 * Call this at application startup for best performance.
 */
export async function initializeDefaultCalculator(): Promise<void> {
  await getDefaultTokenCalculator();
}

/**
 * Pack context items until budget is exhausted.
 *
 * @param context - Context to pack
 * @param budget - Budget in tokens/chars (defaults to calculator's default)
 * @param calculator - Budget calculator (defaults to token-based)
 */
export function packUntilFull(
  context: Context,
  budget?: number,
  calculator?: IBudgetCalculator,
): BudgetResult {
  const calc = calculator ?? createDefaultCalculator();
  const budgetUnits = budget ?? calc.getDefaultBudget();

  const totalUnits = calc.calculateTotalTokens(context);
  if (totalUnits <= budgetUnits) {
    return { context, truncated: false };
  }

  const primaryUnits = calc.count(context.primaryText ?? '');
  const diffUnits = calc.calculateDiffTokens(context);

  // Calculate minimum guaranteed budgets for critical content
  // Ensure diffs get at least what they need (up to 30% of budget)
  const minDiffBudget = diffUnits > 0 ? Math.min(diffUnits, Math.floor(budgetUnits * 0.3)) : 0;
  const minTargetBudget = Math.floor(budgetUnits * 0.1); // Guarantee 10% for targets

  const remainingUnits = budgetUnits - primaryUnits;
  if (remainingUnits <= 0) {
    const emergencyDiffBudget =
      diffUnits > 0 ? Math.max(1, Math.min(diffUnits, Math.floor(budgetUnits * 0.1))) : 0;
    const minDiffUnits = Math.min(calc.count('x'.repeat(16)), Math.max(1, emergencyDiffBudget));
    let remainingDiffUnits = emergencyDiffBudget;

    const stagedDiff = context.stagedDiff
      ? truncateWithMarker(context.stagedDiff, remainingDiffUnits, minDiffUnits, calc)
      : undefined;
    if (stagedDiff) remainingDiffUnits = Math.max(0, remainingDiffUnits - calc.count(stagedDiff));

    const unstagedDiff = context.unstagedDiff
      ? truncateWithMarker(context.unstagedDiff, remainingDiffUnits, minDiffUnits, calc)
      : undefined;
    if (unstagedDiff) {
      remainingDiffUnits = Math.max(0, remainingDiffUnits - calc.count(unstagedDiff));
    }

    const gitDiff =
      !stagedDiff && !unstagedDiff && context.gitDiff
        ? truncateWithMarker(context.gitDiff, remainingDiffUnits, minDiffUnits, calc)
        : undefined;
    if (gitDiff) remainingDiffUnits = Math.max(0, remainingDiffUnits - calc.count(gitDiff));

    const untrackedDiff = context.untrackedDiff
      ? truncateWithMarker(context.untrackedDiff, remainingDiffUnits, minDiffUnits, calc)
      : undefined;

    return {
      context: {
        ...context,
        relatedFiles: [],
        rgSnippets: [],
        gitDiff,
        stagedDiff,
        unstagedDiff,
        untrackedDiff,
      },
      truncated: true,
    };
  }

  // Reserve budget for diffs and targets
  const reservedForDiff = Math.max(minDiffBudget, 0);
  const reservedForTargets = Math.max(minTargetBudget, 0);
  let remainingForContent = Math.max(0, remainingUnits - reservedForDiff - reservedForTargets);

  const targetSet = buildTargetSet(context);
  const relatedFiles = [...(context.relatedFiles ?? [])].sort((a, b) => {
    const aIsTarget = targetSet.has(normalizePath(a.path).replace(/^(\.\/|\/)+/, ''));
    const bIsTarget = targetSet.has(normalizePath(b.path).replace(/^(\.\/|\/)+/, ''));
    if (aIsTarget !== bIsTarget) return aIsTarget ? -1 : 1;
    return 0;
  });

  const truncatedRelated: RelatedFileContext[] = [];
  let usedTargetBudget = 0;

  // Pack related files (targets use reserved budget, others use remaining)
  for (const file of relatedFiles) {
    const isTarget = targetSet.has(normalizePath(file.path).replace(/^(\.\/|\/)+/, ''));
    const fileUnits = calc.calculateFileTokens(file);

    // Determine available budget
    const availableBudget = isTarget
      ? Math.max(0, reservedForTargets - usedTargetBudget)
      : remainingForContent;

    if (fileUnits <= availableBudget) {
      truncatedRelated.push(file);
      if (isTarget) {
        usedTargetBudget += fileUnits;
      } else {
        remainingForContent -= fileUnits;
      }
      continue;
    }

    const outline = file.outline;
    const outlineUnits = outline ? calc.count(outline) : 0;
    const minSnippetUnits = calc.count('x'.repeat(LIMITS.minSnippetChars));

    if (outline && outlineUnits <= availableBudget && outlineUnits >= minSnippetUnits) {
      const outlineContent = `${outline}\n\n${text.context.relatedContentTruncated}`;
      truncatedRelated.push({
        ...file,
        mode: 'outline',
        content: outlineContent,
        outline: undefined,
      });
      const outlineSize = calc.count(outlineContent);
      if (isTarget) {
        usedTargetBudget += outlineSize;
      } else {
        remainingForContent -= outlineSize;
      }
      continue;
    }

    // Force include target outline even if over budget
    if (isTarget && outline && outlineUnits >= minSnippetUnits) {
      const outlineContent = `${outline}\n\n${text.context.relatedContentTruncated}`;
      truncatedRelated.push({
        ...file,
        mode: 'outline',
        content: outlineContent,
        outline: undefined,
      });
      continue;
    }

    if (availableBudget >= minSnippetUnits) {
      const ratio = availableBudget / fileUnits;
      const sliceLen = Math.floor((file.content?.length ?? 0) * ratio);
      truncatedRelated.push({
        ...file,
        mode: 'outline',
        content: file.content?.substring(0, sliceLen) ?? '',
        outline: undefined,
      });
      if (isTarget) {
        usedTargetBudget += availableBudget;
      } else {
        remainingForContent = 0;
      }
    }
    break;
  }

  // Add unused target budget back to content budget
  remainingForContent += Math.max(0, reservedForTargets - usedTargetBudget);

  const snippets = [...context.rgSnippets].sort((a, b) => {
    const aIsTarget = targetSet.has(normalizePath(a.file).replace(/^(\.\/|\/)+/, ''));
    const bIsTarget = targetSet.has(normalizePath(b.file).replace(/^(\.\/|\/)+/, ''));
    if (aIsTarget !== bIsTarget) return aIsTarget ? -1 : 1;
    return 0;
  });

  const truncatedSnippets: RipgrepResult[] = [];
  for (const snippet of snippets) {
    const snippetUnits = calc.calculateSnippetTokens(snippet);

    if (snippetUnits <= remainingForContent) {
      truncatedSnippets.push(snippet);
      remainingForContent -= snippetUnits;
      continue;
    }

    const minSnippetUnits = calc.count('x'.repeat(LIMITS.minSnippetChars));
    if (remainingForContent >= minSnippetUnits) {
      const ratio = remainingForContent / snippetUnits;
      const sliceLen = Math.floor((snippet.content?.length ?? 0) * ratio);
      truncatedSnippets.push({
        ...snippet,
        content: snippet.content?.substring(0, sliceLen) ?? '',
      });
    }
    break;
  }

  // Pack diffs using reserved budget
  let remainingDiffUnits = reservedForDiff;

  // Minimum diff budget - adjust based on available budget
  const minDiffUnits = Math.min(calc.count('x'.repeat(32)), Math.max(1, remainingDiffUnits));

  const stagedDiff = context.stagedDiff
    ? truncateWithMarker(context.stagedDiff, remainingDiffUnits, minDiffUnits, calc)
    : undefined;
  if (stagedDiff) remainingDiffUnits = Math.max(0, remainingDiffUnits - calc.count(stagedDiff));

  const unstagedDiff = context.unstagedDiff
    ? truncateWithMarker(context.unstagedDiff, remainingDiffUnits, minDiffUnits, calc)
    : undefined;
  if (unstagedDiff) remainingDiffUnits = Math.max(0, remainingDiffUnits - calc.count(unstagedDiff));

  const gitDiff =
    !stagedDiff && !unstagedDiff && context.gitDiff
      ? truncateWithMarker(context.gitDiff, remainingDiffUnits, minDiffUnits, calc)
      : undefined;
  if (gitDiff) remainingDiffUnits -= calc.count(gitDiff);

  const untrackedDiff = context.untrackedDiff
    ? truncateWithMarker(context.untrackedDiff, remainingDiffUnits, minDiffUnits, calc)
    : undefined;

  return {
    context: {
      ...context,
      relatedFiles: truncatedRelated,
      rgSnippets: truncatedSnippets,
      stagedDiff,
      unstagedDiff,
      gitDiff,
      untrackedDiff,
    },
    truncated: true,
  };
}
