import { LIMITS } from './limits.js';

// Check if it is a valid unified diff format
export function isUnifiedDiff(text: string): boolean {
  return text.startsWith('diff --git');
}

// Count the number of files changed in the diff
export function countFilesChanged(diff: string): number {
  return (diff.match(/^diff --git/gm) || []).length;
}

// Count the number of changed lines in the diff
export function countDiffLines(diff: string): number {
  return (diff.match(/^[+-]/gm) || []).length;
}

// Comprehensive validation of diff validity
export function validateDiff(diff: string, limits = LIMITS): void {
  if (!isUnifiedDiff(diff)) {
    throw new Error('Invalid diff format: must be unified diff starting with "diff --git"');
  }
  
  const fileCount = countFilesChanged(diff);
  if (fileCount > limits.maxFilesChanged) {
    throw new Error(`Exceeds max files changed (${limits.maxFilesChanged}): ${fileCount} files`);
  }
  
  const lineCount = countDiffLines(diff);
  if (lineCount > limits.maxDiffLines) {
    throw new Error(`Exceeds max diff lines (${limits.maxDiffLines}): ${lineCount} lines`);
  }
}