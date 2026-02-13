import { normalize as pathNormalize, extname } from 'path';

import { text } from '../locales/index.js';

import { OpType, ShadowOperation } from './grizzco/domain/grizzco-types.js';
import { LIMITS } from './limits.js';
import { DiffValidationError } from './types.js';

/**
 * Metadata about a validated diff.
 */
export interface DiffMeta {
  changedFiles: string[];
  fileCount: number;
  lineCount: number;
}

/**
 * Normalizes a raw diff string by trimming and unwrapping markdown code blocks.
 */
const isAbsolutePathLike = (value: string): boolean => {
  const normalized = value.replace(/\\/g, '/');
  return normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized);
};

const cleanPath = (path: string) => {
  if (path === '/dev/null' || path === 'dev/null') return path;
  const rawNormalized = pathNormalize(path).replace(/\\/g, '/');
  const rawSegments = rawNormalized.split('/');
  if (rawSegments.some((seg) => seg === '..') || isAbsolutePathLike(rawNormalized)) {
    throw new DiffValidationError(`Path traversal detected: ${path}`);
  }
  const isAbsolute = isAbsolutePathLike(path);
  let normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/');
  normalized = normalized.replace(/^[a-zA-Z]:\//, '');
  if (normalized.startsWith('/')) normalized = normalized.substring(1);
  normalized = normalized.replace(/^\.\/+/, '');
  if (!isAbsolute) {
    const parts = normalized.split('/');
    if (parts.length > 1) {
      const repoStripAllowList = new Set([
        'src',
        'lib',
        'app',
        'tests',
        'test',
        'packages',
        'include',
        'bin',
        'docs',
        'components',
        'utils',
        'core',
      ]);
      const repoStripFileExtAllowList = new Set([
        '.js',
        '.ts',
        '.jsx',
        '.tsx',
        '.json',
        '.md',
        '.txt',
        '.css',
        '.html',
        '.vue',
        '.py',
        '.rs',
        '.go',
        '.java',
        '.c',
        '.cpp',
        '.h',
      ]);
      const firstDir = parts[0]?.toLowerCase();
      const secondDir = parts[1]?.toLowerCase();
      const secondExt = secondDir ? extname(secondDir) : '';
      const firstIsCommonDir = firstDir ? repoStripAllowList.has(firstDir) : false;
      const secondIsAllowedDir = secondDir ? repoStripAllowList.has(secondDir) : false;
      const secondIsAllowedFile = secondExt ? repoStripFileExtAllowList.has(secondExt) : false;
      const firstLooksLikeRepo =
        !!firstDir &&
        /^[a-z0-9][a-z0-9._-]*$/i.test(firstDir) &&
        firstDir !== '.' &&
        firstDir !== '..';
      if (!firstIsCommonDir && firstLooksLikeRepo && (secondIsAllowedDir || secondIsAllowedFile)) {
        normalized = parts.slice(1).join('/');
      }
    }
  }
  const finalNormalized = pathNormalize(normalized).replace(/\\/g, '/');
  if (finalSegments_check(finalNormalized)) {
    throw new DiffValidationError(`Path traversal detected after normalization: ${path}`);
  }
  return finalNormalized;
};

function finalSegments_check(path: string): boolean {
  const finalSegments = path.split('/');
  return finalSegments.some((seg) => seg === '..') || isAbsolutePathLike(path);
}

function dedentUnifiedDiff(content: string): string {
  const lines = content.split('\n');
  const candidates: number[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const trimmed = line.trimStart();

    // Only consider lines that are expected to be left-aligned in unified diffs.
    // Avoid context lines that *legitimately* start with a single space.
    const isDiffLike =
      trimmed.startsWith('diff --git ') ||
      trimmed.startsWith('index ') ||
      trimmed.startsWith('--- ') ||
      trimmed.startsWith('+++ ') ||
      trimmed.startsWith('@@ ') ||
      trimmed.startsWith('new file mode ') ||
      trimmed.startsWith('deleted file mode ') ||
      trimmed.startsWith('similarity index ') ||
      trimmed.startsWith('rename from ') ||
      trimmed.startsWith('rename to ') ||
      trimmed.startsWith('old mode ') ||
      trimmed.startsWith('new mode ') ||
      trimmed.startsWith('Binary files ') ||
      trimmed.startsWith('GIT binary patch') ||
      trimmed.startsWith('\\ No newline at end of file');

    if (!isDiffLike) continue;

    const indentMatch = line.match(/^\s+/);
    if (!indentMatch) continue;
    candidates.push(indentMatch[0].length);
  }

  const minIndent = candidates.length > 0 ? Math.min(...candidates) : 0;
  if (minIndent <= 0) return content;

  return lines
    .map((line) => {
      if (!line) return line;
      const indent = line.match(/^\s+/)?.[0]?.length ?? 0;
      if (indent < minIndent) return line;
      return line.slice(minIndent);
    })
    .join('\n');
}

export function normalizeDiff(raw: string): string {
  const t = raw.trim();
  let content = t;
  const match = t.match(/```(?:diff)?\s*\n([\s\S]*?)\n```/i) || t.match(/(diff --git [\s\S]*)$/i);
  if (match) content = match[1] || match[0];
  content = dedentUnifiedDiff(content);
  const diffStart = content.search(/^(diff --git |--- a\/)/m);
  if (diffStart !== -1) content = content.substring(diffStart);
  return (
    content
      .replace(
        /^diff --git a\/(.+?) b\/(.+)$/gm,
        (_, p1, p2) => `diff --git a/${cleanPath(p1)} b/${cleanPath(p2)}`,
      )
      .replace(/^--- a\/(.+)$/gm, (_, p1) => `--- a/${cleanPath(p1)}`)
      .replace(/^\+\+\+ b\/(.+)$/gm, (_, p1) => `+++ b/${cleanPath(p1)}`)
      .trimEnd() + '\n'
  );
}

export function isUnifiedDiff(text: string): boolean {
  const d = normalizeDiff(text);
  return d.startsWith('diff --git ') || d.startsWith('--- a/');
}

export function validateDiff(rawDiff: string, limits = LIMITS): DiffMeta {
  const diff = normalizeDiff(rawDiff);
  if (!diff.startsWith('diff --git ') && !diff.startsWith('--- a/')) {
    throw new DiffValidationError(text.diff.notUnifiedFormat);
  }
  const changedFiles = new Set<string>();
  let lineCount = 0;
  let pos = 0;
  let nextPos = 0;
  const processLine = (line: string) => {
    if (!line) return;
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match) {
        const aPath = match[1].replace(/\\/g, '/');
        const bPath = match[2].replace(/\\/g, '/');
        if (aPath !== bPath && aPath !== 'dev/null' && bPath !== 'dev/null')
          throw new DiffValidationError(text.diff.fileRenameNotAllowed(aPath, bPath));
        changedFiles.add(bPath);
      }
    } else if (line.startsWith('--- a/')) {
      const match = line.match(/^--- a\/(.+)$/);
      if (match) changedFiles.add(cleanPath(match[1]));
    } else if (line.startsWith('rename from ') || line.startsWith('rename to ')) {
      throw new DiffValidationError(text.diff.fileRenameNotAllowed());
    } else if (
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---') &&
      !line.includes('\\ No newline at end of file')
    ) {
      lineCount++;
    }
  };
  while ((nextPos = diff.indexOf('\n', pos)) !== -1) {
    processLine(diff.substring(pos, nextPos));
    pos = nextPos + 1;
  }
  processLine(diff.substring(pos));
  const fileList = Array.from(changedFiles);
  if (fileList.length === 0) throw new DiffValidationError(text.llm.patchEmpty('File count is 0'));
  if (fileList.length > limits.maxFilesChanged)
    throw new DiffValidationError(
      text.diff.tooManyFiles(fileList.length, limits.maxFilesChanged, fileList),
    );
  if (lineCount === 0 && !diff.includes('GIT binary patch') && !diff.includes('Binary files '))
    throw new DiffValidationError(text.llm.patchEmpty('Line count is 0'));
  if (lineCount > limits.maxDiffLines)
    throw new DiffValidationError(text.diff.tooManyLines(lineCount, limits.maxDiffLines));
  return { changedFiles: fileList, fileCount: fileList.length, lineCount };
}

/**
 * Converts a git unified diff into shadow operations.
 *
 * 🛡️ CRITICAL ARCHITECTURAL NOTE:
 * We DO NOT reconstruct full file content from hunks here. Reconstructing content
 * from a partial diff leads to data loss (the "File Smash" bug).
 * Instead, we treat the patch as an atomic instruction (OpType.PATCH) and store
 * the RAW diff text. The actual merge logic is delegated to the native git-apply engine.
 */
export async function convertDiffToShadowOperations(diff: string): Promise<ShadowOperation[]> {
  const normalized = normalizeDiff(diff);
  const operations: ShadowOperation[] = [];

  if (normalized.includes('diff --git ')) {
    const files = normalized.split('diff --git ');

    for (const filePart of files) {
      if (!filePart.trim()) continue;

      // Restore the header for easier parsing
      const fullPart = 'diff --git ' + filePart;
      const lines = fullPart.split('\n');
      const header = lines[0];

      const match = header.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (!match) continue;

      const path = match[2];
      const isBinary = fullPart.includes('Binary files') || fullPart.includes('GIT binary patch');

      let type = OpType.PATCH;
      if (fullPart.includes('new file mode')) type = OpType.OVERWRITE;
      if (fullPart.includes('deleted file mode')) type = OpType.DELETE;

      operations.push({
        type,
        path,
        content: Buffer.from(fullPart, 'utf8'), // Store the actual patch text or full content
        isBinary,
        encoding: 'utf8',
        lineEnding: 'auto',
      });
    }

    return operations;
  }

  // Some unified diffs omit the `diff --git` line and start directly with `--- a/...` + `+++ b/...`.
  // The validator allows this, so the conversion layer must support it; otherwise APPLY becomes 0/0.
  const lines = normalized.split('\n');
  let startLineIdx: number | null = null;
  let aPath: string | null = null;
  let bPath: string | null = null;

  const flush = (endExclusive: number) => {
    if (startLineIdx === null || !aPath || !bPath) return;
    const blockLines = lines.slice(startLineIdx, endExclusive);
    const body = blockLines.join('\n').trimEnd() + '\n';

    // Add a synthetic `diff --git` header to make downstream parsing and auditing consistent.
    const fullPart = `diff --git a/${aPath} b/${bPath}\n${body}`;

    const isBinary = fullPart.includes('Binary files') || fullPart.includes('GIT binary patch');
    let type = OpType.PATCH;
    if (fullPart.includes('new file mode')) type = OpType.OVERWRITE;
    if (fullPart.includes('deleted file mode')) type = OpType.DELETE;

    operations.push({
      type,
      path: bPath,
      content: Buffer.from(fullPart, 'utf8'),
      isBinary,
      encoding: 'utf8',
      lineEnding: 'auto',
    });

    startLineIdx = null;
    aPath = null;
    bPath = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const aMatch = line.match(/^--- a\/(.+)\s*$/);
    if (aMatch) {
      // Start a new block; if a previous block is open, flush it.
      flush(i);
      startLineIdx = i;
      aPath = cleanPath(aMatch[1]);
      continue;
    }

    const bMatch = line.match(/^\+\+\+ b\/(.+)\s*$/);
    if (bMatch) {
      bPath = cleanPath(bMatch[1]);
      continue;
    }
  }

  flush(lines.length);

  return operations;
}
