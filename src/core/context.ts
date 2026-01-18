import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { LIMITS } from './limits.js';
import { extractKeywords } from './keywords.js';
import type { Context, FileContext, RipgrepResult, RunOptions } from './types.js';
import { ErrorType } from './types.js';
import { findFileDependencies } from './dependency.js';

export class ContextBuilder {
  static async build(options: RunOptions): Promise<Context> {
    let primaryText: string | undefined;

    // Handle primary text from file or selection
    if (options.file) {
      const filePath = options.file;
      primaryText = await readFile(filePath, 'utf-8');
    } else if (options.selection) {
      primaryText = options.selection;
    }

    // Extract keywords and execute ripgrep search
    const keywords = extractKeywords(options.instruction);
    const rgSnippets = await this.searchMultipleKeywords(keywords, options.repo);

    // Get git diff
    const gitDiff = await this.getGitDiff(options.repo);

    // Truncate context
    const context: Context = {
      repoPath: options.repo,
      primaryText,
      rgSnippets,
      gitDiff
    };

    return this.truncateContext(context);
  }

  private static async runRipgrep(query: string, cwd: string): Promise<RipgrepResult[]> {
    return new Promise((resolve) => {
      const child = spawn('rg', ['-n', '--', query], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd
      });

      let output = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        // ripgrep returns non-zero exit code when no match, but stderr is empty
      });

      child.on('close', (code) => {
        if (code === 0 || code === 1) { // 0=match found, 1=no match
          const results: RipgrepResult[] = [];
          const lines = output.trim().split('\n');

          for (const line of lines) {
            const match = line.match(/^(.*?):(\d+):(.*)$/);
            if (match) {
              results.push({
                file: match[1],
                line: parseInt(match[2]),
                content: match[3]
              });
            }
          }
          resolve(results);
        } else {
          // ripgrep not installed or other error, return empty results
          resolve([]);
        }
      });

      child.on('error', () => {
        // ripgrep not installed, return empty results
        resolve([]);
      });
    });
  }

  private static async searchMultipleKeywords(keywords: string[], cwd: string): Promise<RipgrepResult[]> {
    if (keywords.length === 0) {
      return [];
    }

    // Execute all keyword searches in parallel
    const searchPromises = keywords.map(keyword => this.runRipgrep(keyword, cwd));
    const resultsArrays = await Promise.all(searchPromises);

    // Merge results and deduplicate
    const seen = new Set<string>();
    const mergedResults: RipgrepResult[] = [];

    for (const results of resultsArrays) {
      for (const result of results) {
        const key = `${result.file}:${result.line}`;
        if (!seen.has(key)) {
          seen.add(key);
          mergedResults.push(result);
        }
      }
    }

    // Limit number of results (Top 50)
    const limitedResults = mergedResults.slice(0, 50);

    // Sort by file path and line number
    return limitedResults.sort((a, b) => {
      if (a.file !== b.file) {
        return a.file.localeCompare(b.file);
      }
      return a.line - b.line;
    });
  }

  private static async getGitDiff(cwd: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      const child = spawn('git', ['diff'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd
      });

      let output = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0 && output.trim()) {
          resolve(output);
        } else {
          resolve(undefined);
        }
      });
    });
  }

  private static truncateContext(context: Context): Context {
    const totalChars = (context.primaryText?.length || 0) +
                      context.rgSnippets.reduce((sum, snippet) => sum + snippet.content.length, 0) +
                      (context.gitDiff?.length || 0);
    
    if (totalChars <= LIMITS.maxContextChars) {
      return context;
    }
    
    // Prioritize primaryText, truncate rgSnippets proportionally
    const remainingChars = LIMITS.maxContextChars - (context.primaryText?.length || 0);
    const snippetsChars = context.rgSnippets.reduce((sum, snippet) => sum + snippet.content.length, 0);
    
    if (remainingChars <= 0) {
      return {
        ...context,
        rgSnippets: [],
        gitDiff: undefined
      };
    }
    
    const ratio = remainingChars / snippetsChars;
    const truncatedSnippets = context.rgSnippets.map(snippet => ({
      ...snippet,
      content: snippet.content.substring(0, Math.floor(snippet.content.length * ratio))
    }));
    
    return {
      ...context,
      rgSnippets: truncatedSnippets,
      gitDiff: undefined
    };
  }

  /**
   * Extract potential failed file paths from verification output
   */
  static extractFailedFiles(verifyOutput: string): string[] {
    const uniqueFiles = new Set<string>();

    // Strategy 1: Look for file paths followed by line numbers (common in stack traces and compiler output)
    // e.g., src/core/loop.ts:10:5 or src/core/loop.ts(10,5)
    const tracePattern = /([\w-]+\/[\w-./]+\.(?:ts|js|json|md|txt|css|html|jsx|tsx|vue|py|rs|go|java|c|cpp|h))[:\(]\d+/g;
    let match;
    while ((match = tracePattern.exec(verifyOutput)) !== null) {
      uniqueFiles.add(match[1]);
    }

    // Strategy 2: If no specific traces found, fall back to general file path matching
    if (uniqueFiles.size === 0) {
      const pathPattern = /(?:^|\s)((?:[\w-]+\/)*[\w-]+\.(?:ts|js|json|md|txt|css|html|jsx|tsx|vue|py|rs|go|java|c|cpp|h))\b/g;
      while ((match = pathPattern.exec(verifyOutput)) !== null) {
        uniqueFiles.add(match[1]);
      }
    }

    // Filter out node_modules and .git
    return Array.from(uniqueFiles).filter(file =>
      !file.includes('node_modules') && !file.startsWith('.git')
    );
  }

  /**
   * Shrink context based on failed files, error type and token limits
   */
  static async shrinkContext(context: Context, failedFiles: string[], errorType?: ErrorType): Promise<Context> {
    // If no failed files and context is within limits, do not shrink
    const currentTotal = this.calculateTotalChars(context);
    if (failedFiles.length === 0 && currentTotal <= LIMITS.maxContextChars) {
      return context;
    }

    // Normalize failed file paths
    const normalizedFailed = failedFiles.map(f => f.replace(/\\/g, '/'));

    // Adjust shrinking strategy based on error type
    // Compilation/Lint errors: strictly shrink to failed files
    // Test/Logic errors: keep more context for analysis
    const isStrict = errorType === ErrorType.COMPILATION || errorType === ErrorType.LINT;

    // Find dependencies for failed files to include in context
    const dependencyPromises = normalizedFailed.map(f => findFileDependencies(f, context.repoPath));
    const dependenciesArrays = await Promise.all(dependencyPromises);
    const allRelatedFiles = new Set([...normalizedFailed, ...dependenciesArrays.flat()]);
    
    let newSnippets = context.rgSnippets.filter(snippet => {
      const normalizedSnippetFile = snippet.file.replace(/\\/g, '/');
      const isRelatedFile = Array.from(allRelatedFiles).some(related => normalizedSnippetFile.endsWith(related));
      
      if (isStrict) {
        return isRelatedFile;
      }
      
      // In non-strict mode, keep related files and their "neighbors" (same directory)
      if (isRelatedFile) return true;
      
      const snippetDir = normalizedSnippetFile.split('/').slice(0, -1).join('/');
      return Array.from(allRelatedFiles).some(related => {
        const relatedDir = related.split('/').slice(0, -1).join('/');
        return snippetDir === relatedDir && relatedDir.length > 0;
      });
    });

    // Threshold protection: ensure context is not shrunk too much
    // Only apply if original context was large enough
    const originalTotal = this.calculateTotalChars(context);
    if (originalTotal >= LIMITS.minContextChars && this.calculateTotalChars({ ...context, rgSnippets: newSnippets }) < LIMITS.minContextChars) {
      // If shrunk context is too small, restore original snippets until minimum is reached
      for (const s of context.rgSnippets) {
        if (!newSnippets.includes(s)) {
          newSnippets.push(s);
          if (this.calculateTotalChars({ ...context, rgSnippets: newSnippets }) >= LIMITS.minContextChars) break;
        }
      }
    }

    // Final length check
    if (this.calculateTotalChars({ ...context, rgSnippets: newSnippets }) > LIMITS.maxContextChars) {
      newSnippets = newSnippets.slice(0, Math.floor(newSnippets.length * 0.8));
    }

    return {
      ...context,
      rgSnippets: newSnippets
    };
  }

  private static calculateTotalChars(context: Context): number {
    return (context.primaryText?.length || 0) +
           context.rgSnippets.reduce((sum, snippet) => sum + snippet.content.length, 0) +
           (context.gitDiff?.length || 0);
  }
}
