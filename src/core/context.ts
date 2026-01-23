import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import path from 'path';

import { text } from '../locales/index.js';

import { AstParser } from './ast/parser.js';
import { findFileDependencies } from './dependency.js';
import { extractKeywords } from './keywords.js';
import { LIMITS } from './limits.js';
import { logger } from './logger.js';
import { safeJoin, normalizePath } from './path.js';
import type { Context, RipgrepResult, RunOptions } from './types.js';
import { ErrorType, CodeLocation, SymbolInfo } from './types.js';

export class ContextBuilder {
  static async build(options: RunOptions): Promise<Context> {
    logger.trace(`  [CONTEXT] Building context for repo: ${options.repoPath}`);
    logger.trace(`  [CONTEXT] File: ${options.file}, Instruction: ${options.instruction}`);

    let primaryText: string | undefined;

    // Handle primary text from file or selection
    if (options.file) {
      if (options.snapshotHash && options.checkpointManager) {
        // ARCHITECTURE OPTIMIZATION: Read from Git object database
        // This avoids filesystem cache issues entirely, supports untracked files,
        // and provides better performance than filesystem I/O.
        logger.trace(
          `  [CONTEXT] Reading from Git object database: ${options.snapshotHash}:${options.file}`,
        );
        const snapshotContent = await options.checkpointManager.readSnapshotFile(
          options.repoPath,
          options.snapshotHash,
          options.file,
        );
        // Explicitly handle null to undefined conversion for type safety
        primaryText = snapshotContent === null ? undefined : snapshotContent;

        if (primaryText === undefined) {
          throw new Error(
            `File ${options.file} not found in snapshot ${options.snapshotHash}. This may happen if the file is ignored and not explicitly included.`,
          );
        }
        logger.trace(`  [CONTEXT] Successfully read from Git object (${primaryText.length} bytes)`);
      } else {
        // Fallback to filesystem for non-snapshot scenarios or legacy mode
        const filePath = path.isAbsolute(options.file)
          ? options.file
          : safeJoin(options.repoPath, options.file);
        logger.trace(`  [CONTEXT] Reading from filesystem: ${filePath}`);
        primaryText = await readFile(filePath, 'utf-8');
      }
    } else if (options.selection) {
      primaryText = options.selection;
    }

    // Truncate primary text if it exceeds limits to prevent prompt overflow
    if (primaryText && primaryText.length > LIMITS.maxPrimaryChars) {
      primaryText =
        primaryText.substring(0, LIMITS.maxPrimaryChars) + `\n${text.context.contentTruncated}`;
    }

    // Extract keywords and execute ripgrep search
    const keywords = extractKeywords(options.instruction);
    const rgSnippets = await this.searchMultipleKeywords(keywords, options.repoPath);

    // Get git diff (prioritize cached, then unstaged, limited to target file if specified)
    const stagedDiff = await this.getGitDiff(options.repoPath, true, options.file);
    const unstagedDiff = await this.getGitDiff(options.repoPath, false, options.file);

    // Legacy support: combine them for gitDiff, but we will prefer separate fields in LLM
    const gitDiff = [stagedDiff, unstagedDiff].filter(Boolean).join('\n').trim() || undefined;

    // AST Analysis for definitions and references
    let symbols: SymbolInfo[] = [];
    const definitionMap: Record<string, CodeLocation> = {};

    if (primaryText && options.file) {
      try {
        const lang = this.getLanguageFromFile(options.file);
        if (lang) {
          const tree = await AstParser.parse(primaryText, lang);
          const defs = await AstParser.identifyDefinitions(tree, lang);
          const refs = await AstParser.identifyReferences(tree, lang);

          symbols = [...defs, ...refs];
          for (const def of defs) {
            definitionMap[def.name] = def.location;
          }
        }
      } catch (e) {
        logger.warn(`  [CONTEXT] AST analysis failed for ${options.file}: ${e}`);
      }
    }

    // Truncate context
    const context: Context = {
      repoPath: options.repoPath,
      primaryFile: options.file,
      primaryText,
      rgSnippets,
      gitDiff,
      stagedDiff,
      unstagedDiff,
      untrackedDiff: undefined, // Placeholder for future implementation
      untrackedFiles: [], // Placeholder for future implementation
      symbols,
      definitionMap,
    };

    return this.truncateContext(context);
  }

  private static getLanguageFromFile(filePath: string): string | undefined {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.ts':
        return 'typescript';
      case '.tsx':
        return 'tsx';
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return 'javascript';
      case '.py':
        return 'python';
      case '.go':
        return 'go';
      case '.rs':
        return 'rust';
      case '.java':
        return 'java';
      case '.cpp':
      case '.cc':
      case '.h':
        return 'cpp';
      case '.c':
        return 'c';
      default:
        return undefined;
    }
  }

  private static async runRipgrep(query: string, cwd: string): Promise<RipgrepResult[]> {
    logger.trace(`  [RG] Searching for: "${query}" in ${cwd}`);

    return new Promise((resolve) => {
      // Use --json for robust machine-readable output
      const child = spawn(
        'rg',
        [
          '-n',
          '--json',
          '-i',
          '--max-count',
          '100',
          '--glob',
          '!.git',
          '--glob',
          '!node_modules',
          '--',
          query,
          '.',
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd,
        },
      );

      child.stdin?.end();

      const timeout = setTimeout(() => {
        logger.trace(`  [RG] Timeout reached for query: "${query}". Killing process.`);
        child.kill();
      }, 30000); // 30 seconds timeout for each search

      let output = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (_data) => {
        // stderr is collected but currently just resolved to empty results for stability
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        logger.trace(`  [RG] Process closed with code ${code}. Output length: ${output.length}`);

        if (code === 0 || code === 1) {
          // 0=match found, 1=no match
          const results: RipgrepResult[] = [];
          const lines = output.trim().split('\n');

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (data.type === 'match') {
                results.push({
                  // Normalize path to use forward slashes
                  file: normalizePath(String(data.data.path.text)),
                  line: data.data.line_number,
                  // Preserve indentation by only removing trailing newline
                  content: data.data.lines.text.replace(/\n$/, ''),
                });
              }
            } catch (__e) {
              // Ignore malformed JSON
            }
          }
          resolve(results);
        } else {
          // ripgrep error (e.g. not installed, invalid regex)
          resolve([]);
        }
      });

      child.on('error', (err: any) => {
        // Process error (e.g. spawn failed)
        if (err.code === 'ENOENT') {
          logger.error(
            'Error: ripgrep (rg) not found in PATH. Context gathering may be incomplete.',
          );
        } else {
          logger.error(`Error running ripgrep: ${err.message}`);
        }
        resolve([]);
      });
    });
  }

  private static async searchMultipleKeywords(
    keywords: string[],
    cwd: string,
  ): Promise<RipgrepResult[]> {
    if (keywords.length === 0) {
      return [];
    }

    // Cap keywords to prevent excessive resource usage and concurrency
    // NOTE: maxKeywords should be kept small (<= 5) to avoid hitting OS process limits
    const cappedKeywords = keywords.slice(0, LIMITS.maxKeywords);

    logger.trace(`  [CONTEXT] Searching keywords: ${cappedKeywords.join(', ')}`);

    // Execute all keyword searches in parallel
    const searchPromises = cappedKeywords.map((keyword) => this.runRipgrep(keyword, cwd));
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

  private static async getGitDiff(
    cwd: string,
    cached = false,
    file?: string,
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      const args = ['diff'];
      if (cached) args.push('--cached');
      if (file) args.push('--', file);

      const child = spawn('git', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd,
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
