import { LIMITS } from './limits.js';
import { text } from '../locales/index.js';

export interface DiffMeta {
  changedFiles: string[];
  fileCount: number;
  lineCount: number;
}

/**
 * Normalizes a raw diff string by trimming and unwrapping markdown code blocks.
 */
export function normalizeDiff(raw: string): string {
  const t = raw.trim();
  // unwrap ```diff ... ``` or ``` ... ```
  const m = t.match(/^```(?:diff)?\s*\n([\s\S]*?)\n```$/i);
  return (m ? m[1] : raw).trim();
}

// Check if it is a valid unified diff format
export function isUnifiedDiff(text: string): boolean {
  const d = normalizeDiff(text);
  return d.startsWith('diff --git ');
}

/**
 * Asserts that the diff does not contain file operations like creation, deletion, or renaming.
 */
export function assertNoFileOps(diff: string): void {
  const d = normalizeDiff(diff);
  if (/^new file mode/m.test(d)) throw new Error(text.diff.fileCreationNotAllowed);
  if (/^deleted file mode/m.test(d)) throw new Error(text.diff.fileDeletionNotAllowed);
  if (/^rename (from|to) /m.test(d)) throw new Error(text.diff.fileRenameNotAllowed);
}

// Extract changed files from diff
export function extractChangedFiles(diff: string): string[] {
  const files = new Set<string>();
  const diffGitPattern = /^diff --git a\/(.+?) b\/(.+)$/gm;

  let match;
  while ((match = diffGitPattern.exec(diff)) !== null) {
    // a/foo.ts b/foo.ts → foo.ts
    const b = match[2];
    if (b !== 'dev/null') {
      files.add(b.replace(/\\/g, '/'));
    }
  }

  return Array.from(files);
}

// Count the number of files changed in the diff
export function countFilesChanged(diff: string): number {
  return extractChangedFiles(diff).length;
}

// Count the number of changed lines in the diff (excluding headers)
export function countDiffLines(diff: string): number {
  const lines = diff.split('\n');
  let count = 0;
  for (const line of lines) {
    if ((line.startsWith('+') || line.startsWith('-')) && 
        !line.startsWith('+++') && !line.startsWith('---')) {
      count++;
    }
  }
  return count;
}

// Comprehensive validation of diff validity
export function validateDiff(rawDiff: string, limits = LIMITS): DiffMeta {
  const diff = normalizeDiff(rawDiff);

  if (!isUnifiedDiff(diff)) {
    throw new Error(text.diff.notUnifiedFormat);
  }

  assertNoFileOps(diff);
  
  const changedFiles = extractChangedFiles(diff);
  const fileCount = changedFiles.length;
  
  if (fileCount > limits.maxFilesChanged) {
    throw new Error(text.diff.tooManyFiles(fileCount, limits.maxFilesChanged));
  }
  
  const lineCount = countDiffLines(diff);
  if (lineCount > limits.maxDiffLines) {
    throw new Error(text.diff.tooManyLines(lineCount, limits.maxDiffLines));
  }

  return {
    changedFiles,
    fileCount,
    lineCount
  };
}
