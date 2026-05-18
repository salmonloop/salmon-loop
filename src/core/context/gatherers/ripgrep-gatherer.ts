import { FileAdapter } from '../../adapters/fs/file-adapter.js';
import { LIMITS } from '../../config/limits.js';
import { getLogger } from '../../observability/logger.js';
import { spawnCommand } from '../../runtime/process-runner.js';
import type { RipgrepResult } from '../../types/context.js';
import { ensureInSandbox, normalizePath, safeJoin, safeRelative } from '../../utils/path.js';

const FALLBACK_EXCLUDED_DIRS = new Set(['.git', 'node_modules']);
const FALLBACK_MAX_FILES = 2000;
const FALLBACK_MAX_FILE_BYTES = Math.max(LIMITS.largeFileThresholdBytes, 64 * 1024);

const fileAdapter = new FileAdapter();

function isHiddenPathSegment(name: string): boolean {
  return name.startsWith('.');
}

function isBinaryLike(content: string): boolean {
  return content.includes('\0');
}

export class RipgrepGatherer {
  private async searchFileSystem(
    query: string,
    cwd: string,
    signal?: AbortSignal,
  ): Promise<RipgrepResult[]> {
    const needle = query.toLowerCase();
    if (!needle) return [];

    const results: RipgrepResult[] = [];
    let scannedFiles = 0;
    const pending = ['.'];

    while (pending.length > 0 && scannedFiles < FALLBACK_MAX_FILES) {
      if (signal?.aborted) throw new Error('Operation cancelled by user');

      const current = pending.shift()!;
      const absoluteCurrent = ensureInSandbox(cwd, safeJoin(cwd, current));
      let entries;
      try {
        entries = await fileAdapter.readdirWithTypes(absoluteCurrent);
      } catch {
        continue;
      }

      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (signal?.aborted) throw new Error('Operation cancelled by user');
        if (isHiddenPathSegment(entry.name)) continue;
        if (entry.isSymbolicLink()) continue;

        const relativePath = normalizePath(safeJoin(current, entry.name)).replace(
          /^(\.\/|\/)+/,
          '',
        );
        if (!relativePath) continue;

        if (entry.isDirectory()) {
          if (FALLBACK_EXCLUDED_DIRS.has(entry.name)) continue;
          pending.push(relativePath);
          continue;
        }

        if (!entry.isFile()) continue;
        scannedFiles += 1;
        if (scannedFiles > FALLBACK_MAX_FILES) break;

        const absoluteFile = ensureInSandbox(cwd, safeJoin(cwd, relativePath));
        try {
          const stat = await fileAdapter.stat(absoluteFile);
          if (!stat.isFile() || stat.size > FALLBACK_MAX_FILE_BYTES) continue;
          const content = await fileAdapter.readFile(absoluteFile, 'utf-8');
          if (isBinaryLike(content)) continue;
          const lines = content.split(/\r?\n/);
          for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? '';
            if (!line.toLowerCase().includes(needle)) continue;
            results.push({
              file: normalizePath(safeRelative(cwd, absoluteFile)),
              line: index + 1,
              content: line,
            });
            if (results.length >= LIMITS.defaultSearchMatches) return results;
          }
        } catch {
          continue;
        }
      }
    }

    return results;
  }

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
          'Error: ripgrep (rg) not found in PATH. Falling back to bounded filesystem search.',
        );
        return await this.searchFileSystem(query, cwd, signal);
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
