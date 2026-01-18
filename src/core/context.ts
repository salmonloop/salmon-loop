import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { LIMITS } from './limits.js';
import { extractKeywords } from './keywords.js';
import type { Context, FileContext, RipgrepResult, RunOptions } from './types.js';

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
}
