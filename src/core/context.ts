import { ContextService } from './context/service.js';
import { findFileDependencies } from './dependency.js';
import { LIMITS } from './limits.js';
import { normalizePath } from './path.js';
import type { Context, RipgrepResult, RunOptions } from './types.js';
import { ErrorType } from './types.js';

export class ContextBuilder {
  static async build(options: RunOptions): Promise<Context> {
    const service = new ContextService();
    const result = await service.build({
      instruction: options.instruction,
      repoPath: options.repoPath,
      primaryFile: options.file,
      selection: options.selection,
      snapshotHash: options.snapshotHash,
      checkpointManager: options.checkpointManager,
    });

    return result.context;
  }

  /**
   * Truncates context to fit within character limits.
   * Priority: primaryText > rgSnippets > gitDiff
   * NOTE: gitDiff is currently dropped if context exceeds limits to reduce noise.
   * Truncation strategy: Pack-until-full (keep complete snippets until budget is reached).
   */
  private static truncateContext(context: Context): Context {
    const totalChars = this.calculateTotalChars(context);

    if (totalChars <= LIMITS.maxContextChars) {
      return context;
    }

    // Prioritize primaryText, then pack snippets until budget is reached
    let remainingChars = LIMITS.maxContextChars - (context.primaryText?.length || 0);

    if (remainingChars <= 0) {
      return {
        ...context,
        rgSnippets: [],
        gitDiff: undefined,
      };
    }

    const truncatedSnippets: RipgrepResult[] = [];
    for (const snippet of context.rgSnippets) {
      const snippetLen = snippet.content?.length ?? 0;
      if (snippetLen <= remainingChars) {
        truncatedSnippets.push(snippet);
        remainingChars -= snippetLen;
      } else {
        // Only truncate the last one if it provides meaningful content
        if (remainingChars >= LIMITS.minSnippetChars) {
          truncatedSnippets.push({
            ...snippet,
            content: snippet.content.substring(0, remainingChars),
          });
        }
        break;
      }
    }

    return {
      ...context,
      rgSnippets: truncatedSnippets,
      gitDiff: undefined,
    };
  }

  /**
   * Extract potential failed file paths from verification output
   */
  static extractFailedFiles(verifyOutput: string): string[] {
    const uniqueFiles = new Set<string>();

    // Strategy 1: Look for file paths followed by line numbers (common in stack traces and compiler output)
    // We handle both quoted and unquoted paths.
    const patterns = [
      // Quoted paths (can contain spaces)
      /"([^"\n]+\.(?:ts|js|json|md|txt|css|html|jsx|tsx|vue|py|rs|go|java|c|cpp|h))"[:(]\d+/gu,
      // Unquoted paths (no spaces allowed to avoid over-matching)
      /((?:[a-zA-Z]:)?[^\s:()"]+\.(?:ts|js|json|md|txt|css|html|jsx|tsx|vue|py|rs|go|java|c|cpp|h))[:(]\d+/gu,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(verifyOutput)) !== null) {
        let p = normalizePath(match[1].trim());
        p = p.replace(/^(\.\/|\/)/, '');
        p = p.replace(/^[a-zA-Z]:\//, '');
        uniqueFiles.add(p);
      }
    }

    // Strategy 2: Fall back to general file path matching for paths without line numbers
    const pathPattern =
      /(?:^|\s)((?:[a-zA-Z]:)?[^\s:()"]+\.(?:ts|js|json|md|txt|css|html|jsx|tsx|vue|py|rs|go|java|c|cpp|h))\b/gu;
    let match2;
    while ((match2 = pathPattern.exec(verifyOutput)) !== null) {
      let p = normalizePath(match2[1].trim());
      p = p.replace(/^(\.\/|\/)/, '');
      p = p.replace(/^[a-zA-Z]:\//, '');
      uniqueFiles.add(p);
    }

    // Filter out node_modules and .git
    return Array.from(uniqueFiles).filter(
      (file) => !file.includes('node_modules') && !file.startsWith('.git'),
    );
  }

  /**
   * Shrink context based on failed files, error type and token limits.
   * Uses deterministic rules: failed files + limited static dependencies.
   * Protects against over-shrinking by falling back to original context if budget allows.
   */
  static async shrinkContext(
    context: Context,
    failedFiles: string[],
    _errorType?: ErrorType,
  ): Promise<Context> {
    // Normalize failed file paths
    const normalizedFailed = failedFiles.map((f) => normalizePath(f));

    if (normalizedFailed.length > 0) {
      // Find dependencies for failed files to include in context
      const dependencyPromises = normalizedFailed.map((f) =>
        findFileDependencies(f, context.repoPath).catch(() => []),
      );
      const dependenciesArrays = await Promise.all(dependencyPromises);

      // Cap related files to ensure determinism and performance
      const allRelatedFiles = new Set([
        ...normalizedFailed,
        ...dependenciesArrays.flat().slice(0, LIMITS.maxRelatedFiles),
      ]);

      let newSnippets = context.rgSnippets.filter((snippet) => {
        const normalizedSnippetFile = normalizePath(snippet.file);
        return Array.from(allRelatedFiles).some((related) =>
          normalizedSnippetFile.endsWith(related),
        );
      });

      // Cap snippets after shrink to keep context focused
      newSnippets = newSnippets.slice(0, LIMITS.maxSnippetsAfterShrink);

      const shrunkContext = {
        ...context,
        rgSnippets: newSnippets,
      };

      // Protection against over-shrinking: if shrunk context is too small,
      // fallback to original context (but still truncated to max budget)
      if (this.calculateTotalChars(shrunkContext) < LIMITS.minContextChars) {
        return this.truncateContext(context);
      }

      return shrunkContext;
    }

    // If no failed files, keep original keyword matches but ensure they are within limits
    return this.truncateContext(context);
  }

  /**
   * Calculates approximate context size in characters.
   * NOTE: This is NOT token count. Used only for heuristic limits and shrinking.
   */
  private static calculateTotalChars(context: Context): number {
    const primary = context.primaryText?.length ?? 0;
    const snippets = context.rgSnippets.reduce(
      (sum, snippet) => sum + (snippet.content?.length ?? 0),
      0,
    );
    const diff =
      (context.gitDiff?.length ?? 0) +
      (context.stagedDiff?.length ?? 0) +
      (context.unstagedDiff?.length ?? 0) +
      (context.untrackedDiff?.length ?? 0);

    return primary + snippets + diff;
  }
}
