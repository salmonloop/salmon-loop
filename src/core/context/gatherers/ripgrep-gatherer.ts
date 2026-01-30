import { spawn } from 'child_process';

import { LIMITS } from '../../limits.js';
import { logger } from '../../logger.js';
import { normalizePath } from '../../path.js';
import type { RipgrepResult } from '../../types.js';

export class RipgrepGatherer {
  private async runRipgrep(query: string, cwd: string): Promise<RipgrepResult[]> {
    logger.trace(`  [RG] Searching for: "${query}" in ${cwd}`);

    return new Promise((resolve) => {
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
      }, 30000);

      let output = '';
      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        logger.trace(`  [RG] Process closed with code ${code}. Output length: ${output.length}`);

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
          resolve(results);
          return;
        }

        resolve([]);
      });

      child.on('error', (err: any) => {
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

  async searchMultipleKeywords(keywords: string[], cwd: string): Promise<RipgrepResult[]> {
    if (keywords.length === 0) return [];

    const cappedKeywords = keywords.slice(0, LIMITS.maxKeywords);
    logger.trace(`  [CONTEXT] Searching keywords: ${cappedKeywords.join(', ')}`);

    const searchPromises = cappedKeywords.map((keyword) => this.runRipgrep(keyword, cwd));
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
