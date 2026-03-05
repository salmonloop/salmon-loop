import { LIMITS } from '../../config/limits.js';
import { getLogger } from '../../observability/logger.js';
import { spawnCommand } from '../../runtime/process-runner.js';
import type { RipgrepResult } from '../../types/context.js';
import { normalizePath } from '../../utils/path.js';

export class RipgrepGatherer {
  private async runRipgrep(
    query: string,
    cwd: string,
    signal?: AbortSignal,
  ): Promise<RipgrepResult[]> {
    getLogger().trace(`  [RG] Searching for: "${query}" in ${cwd}`);

    if (signal?.aborted) {
      throw new Error('Operation cancelled by user');
    }

    let output = '';
    const result = await spawnCommand({
      command: 'rg',
      args: [
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
      cwd,
      signal,
      timeoutMs: LIMITS.defaultToolTimeoutMs,
      onStdoutChunk: (data) => {
        output += Buffer.from(data).toString();
      },
    });

    if (signal?.aborted || result.aborted) {
      throw new Error('Operation cancelled by user');
    }

    getLogger().trace(
      `  [RG] Process closed with code ${result.code}. Output length: ${output.length}`,
    );

    if (result.error) {
      if (result.error.code === 'ENOENT') {
        getLogger().error(
          'Error: ripgrep (rg) not found in PATH. Context gathering may be incomplete.',
        );
      } else {
        getLogger().error(`Error running ripgrep: ${result.error.message}`);
      }
      return [];
    }

    if (result.timedOut) {
      getLogger().trace(`  [RG] Timeout reached for query: "${query}".`);
      return [];
    }

    if (result.code !== 0 && result.code !== 1) {
      return [];
    }

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
    return results;
  }

  async searchMultipleKeywords(
    keywords: string[],
    cwd: string,
    signal?: AbortSignal,
  ): Promise<RipgrepResult[]> {
    if (keywords.length === 0) return [];
    if (signal?.aborted) throw new Error('Operation cancelled by user');

    const cappedKeywords = keywords.slice(0, LIMITS.maxKeywords);
    getLogger().trace(`  [CONTEXT] Searching keywords: ${cappedKeywords.join(', ')}`);

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
