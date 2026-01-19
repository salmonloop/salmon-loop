import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import path from 'node:path';
import { LIMITS } from './limits.js';
import { extractKeywords } from './keywords.js';
import type { Context, RipgrepResult, RunOptions } from './types.js';
import { ErrorType } from './types.js';
import { findFileDependencies } from './dependency.js';

export class ContextBuilder {
  static async build(options: RunOptions): Promise<Context> {
    let primaryText: string | undefined;

    // Handle primary text from file or selection
    if (options.file) {
      const filePath = path.isAbsolute(options.file)
        ? options.file
        : path.join(options.repoPath, options.file);
      primaryText = await readFile(filePath, 'utf-8');
    } else if (options.selection) {
      primaryText = options.selection;
    }

    // Truncate primary text if it exceeds limits to prevent prompt overflow
    if (primaryText && primaryText.length > LIMITS.maxPrimaryChars) {
      primaryText = primaryText.substring(0, LIMITS.maxPrimaryChars) + '\n...[Content truncated for context budget]...';
    }

    // Extract keywords and execute ripgrep search
    const keywords = extractKeywords(options.instruction);
    const rgSnippets = await this.searchMultipleKeywords(keywords, options.repoPath);

    // Get git diff
    const gitDiff = await this.getGitDiff(options.repoPath);

    // Truncate context
    const context: Context = {
      repoPath: options.repoPath,
      primaryText,
      rgSnippets,
      gitDiff
    };

    return this.truncateContext(context);
  }

  private static async runRipgrep(query: string, cwd: string): Promise<RipgrepResult[]> {
    return new Promise((resolve) => {
      // Use --json for robust machine-readable output
      const child = spawn('rg', ['-n', '--json', '--', query], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd
      });

      let output = '';
      let stderr = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0 || code === 1) { // 0=match found, 1=no match
          const results: RipgrepResult[] = [];
          const lines = output.trim().split('\n');

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (data.type === 'match') {
                results.push({
                  // Normalize path to use forward slashes
                  file: String(data.data.path.text).replace(/\\/g, '/'),
                  line: data.data.line_number,
                  // Preserve indentation by only removing trailing newline
                  content: data.data.lines.text.replace(/\n$/, '')
                });
              }
            } catch (e) {
              // Ignore malformed JSON
            }
          }
          resolve(results);
        } else {
          // ripgrep error (e.g. not installed, invalid regex)
          // stderr is collected but currently just resolved to empty results for stability
          resolve([]);
        }
      });

      child.on('error', () => {
        // Process error (e.g. spawn failed)
        resolve([]);
      });
    });
  }

  private static async searchMultipleKeywords(keywords: string[], cwd: string): Promise<RipgrepResult[]> {
    if (keywords.length === 0) {
      return [];
    }

    // Cap keywords to prevent excessive resource usage and concurrency
    // NOTE: maxKeywords should be kept small (<= 5) to avoid hitting OS process limits
    const cappedKeywords = keywords.slice(0, LIMITS.maxKeywords);

    // Execute all keyword searches in parallel
    const searchPromises = cappedKeywords.map(keyword => this.runRipgrep(keyword, cwd));
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

      child.on('error', () => {
        resolve(undefined);
      });
    });
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
        gitDiff: undefined
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
            content: snippet.content.substring(0, remainingChars)
          });
        }
        break;
      }
    }
    
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
    // e.g., src/core/loop.ts:10:5 or loop.ts:10:5
    const tracePattern = /((?:[\w-]+\/)*[\w-./]+\.(?:ts|js|json|md|txt|css|html|jsx|tsx|vue|py|rs|go|java|c|cpp|h))[:\(]\d+/g;
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
   * Shrink context based on failed files, error type and token limits.
   * Uses deterministic rules: failed files + limited static dependencies.
   * Protects against over-shrinking by falling back to original context if budget allows.
   */
  static async shrinkContext(context: Context, failedFiles: string[], errorType?: ErrorType): Promise<Context> {
    // Normalize failed file paths
    const normalizedFailed = failedFiles.map(f => f.replace(/\\/g, '/'));

    if (normalizedFailed.length > 0) {
      // Find dependencies for failed files to include in context
      const dependencyPromises = normalizedFailed.map(f => 
        findFileDependencies(f, context.repoPath).catch(() => [])
      );
      const dependenciesArrays = await Promise.all(dependencyPromises);
      
      // Cap related files to ensure determinism and performance
      const allRelatedFiles = new Set([
        ...normalizedFailed, 
        ...dependenciesArrays.flat().slice(0, LIMITS.maxRelatedFiles)
      ]);
      
      let newSnippets = context.rgSnippets.filter(snippet => {
        const normalizedSnippetFile = snippet.file.replace(/\\/g, '/');
        return Array.from(allRelatedFiles).some(related => normalizedSnippetFile.endsWith(related));
      });

      // Cap snippets after shrink to keep context focused
      newSnippets = newSnippets.slice(0, LIMITS.maxSnippetsAfterShrink);

      const shrunkContext = {
        ...context,
        rgSnippets: newSnippets
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
      0
    );
    const diff = context.gitDiff?.length ?? 0;

    return primary + snippets + diff;
  }
}
