import { LIMITS } from './limits.js';

// 检查是否为合法的 unified diff 格式
export function isUnifiedDiff(text: string): boolean {
  return text.startsWith('diff --git');
}

// 统计 diff 中修改的文件数量
export function countFilesChanged(diff: string): number {
  return (diff.match(/^diff --git/gm) || []).length;
}

// 统计 diff 中的变更行数
export function countDiffLines(diff: string): number {
  return (diff.match(/^[+-]/gm) || []).length;
}

// 综合校验 diff 的合法性
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