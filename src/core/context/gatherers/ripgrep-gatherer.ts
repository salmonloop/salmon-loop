import { spawn } from 'child_process';

import { LIMITS } from '../../config/limits.js';
import { logger } from '../../observability/logger.js';
import type { RipgrepResult } from '../../types/index.js';
import { normalizePath } from '../../utils/path.js';

export class RipgrepGatherer {
  private async runRipgrep(
    query: string,
    cwd: string,
    signal?: AbortSignal,
  ): Promise<RipgrepResult[]> {
    logger.trace(`  [RG] Searching for: "${query}" in ${cwd}`);

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Operation cancelled by user'));
        return;
      }

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
          signal,
        },
      );

      child.stdin?.end();

      const timeout = setTimeout(() => {
        logger.trace(`  [RG] Timeout reached for query: "${query}". Killing process.`);
        child.kill();
      }, LIMITS.defaultToolTimeoutMs);

      let settled = false;
      const settleResolve = (results: RipgrepResult[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (onAbort) signal?.removeEventListener('abort', onAbort);
        resolve(results);
      };
      const settleReject = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (onAbort) signal?.removeEventListener('abort', onAbort);
        reject(error);
      };

      const onAbort = signal
        ? () => {
            try {
              child.kill();
            } catch {
              // Ignore
            }
            settleReject(new Error('Operation cancelled by user'));
          }
        : undefined;
      if (onAbort) signal?.addEventListener('abort', onAbort, { once: true });

      let output = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        logger.trace(`  [RG] Process closed with code ${code}. Output length: ${output.length}`);

        if (signal?.aborted) {
          settleReject(new Error('Operation cancelled by user'));
          return;
        }

        if (code === 0 || code === 1) {
          const results: RipgrepResult[] = [];
          const lines = output.trim().split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (data.type === 'match') {
                results.push({
                  file: normalizePath(String(data.data.path.text)),
                  line: data.data.line_number,
                  content: data.data.lines.text.replace(/\n$/, ''),
                });
              }
            } catch {
              // Ignore malformed JSON.
            }
          }
          settleResolve(results);
          return;
        }

        settleResolve([]);
      });

      child.on('error', (err: any) => {
        if (signal?.aborted) {
          settleReject(new Error('Operation cancelled by user'));
          return;
        }
        if (err.code === 'ENOENT') {
          logger.error(
            'Error: ripgrep (rg) not found in PATH. Context gathering may be incomplete.',
          );
        } else {
          logger.error(`Error running ripgrep: ${err.message}`);
        }
        settleResolve([]);
      });
    });
  }

  async searchMultipleKeywords(
    keywords: string[],
    cwd: string,
    signal?: AbortSignal,
  ): Promise<RipgrepResult[]> {
    if (keywords.length === 0) return [];
    if (signal?.aborted) throw new Error('Operation cancelled by user');

    const cappedKeywords = keywords.slice(0, LIMITS.maxKeywords);
    logger.trace(`  [CONTEXT] Searching keywords: ${cappedKeywords.join(', ')}`);

    const searchPromises = cappedKeywords.map((keyword) => this.runRipgrep(keyword, cwd, signal));
    const resultsArrays = await Promise.all(searchPromises);

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

    const limitedResults = mergedResults.slice(0, 50);
    return limitedResults.sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      return a.line - b.line;
    });
  }
}
