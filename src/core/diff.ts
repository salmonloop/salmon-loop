import { LIMITS } from './limits.js';
import { text } from '../locales/index.js';
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
 * It tries to find the first code block that looks like a diff or the raw diff itself.
 */
export function normalizeDiff(raw: string): string {
  const t = raw.trim();

  // Optimization: If it already starts with 'diff --git', no need for complex matching
  if (t.startsWith('diff --git ')) {
    return t;
  }

  // Combined regex to find a diff block or the start of a git diff
  // 1. Match ```diff ... ``` or ``` ... ``` containing diff --git
  // 2. Or match from the first 'diff --git ' to the end
  const match = t.match(/```(?:diff)?\s*\n([\s\S]*?)\n```/i) || t.match(/(diff --git [\s\S]*)$/i);

  if (match) {
    const content = match[1].trim();
    // If we matched a code block, it might still have conversational text before 'diff --git'
    const diffStart = content.indexOf('diff --git ');
    return diffStart !== -1 ? content.substring(diffStart).trim() : content;
  }

  return t;
}

/**
 * Check if the text is a valid unified diff format starting with 'diff --git'.
 */
export function isUnifiedDiff(text: string): boolean {
  const d = normalizeDiff(text);
  return d.startsWith('diff --git ');
}

/**
 * Comprehensive validation of diff validity.
 * Performs a single pass over the lines to extract metadata and enforce safety rules.
 * 
 * @param rawDiff - The raw diff string from LLM.
 * @param limits - The limits to enforce (max files, max lines).
 * @returns Metadata about the validated diff.
 * @throws DiffValidationError if the diff is invalid or violates safety rules.
 */
export function validateDiff(rawDiff: string, limits = LIMITS): DiffMeta {
  const diff = normalizeDiff(rawDiff);

  // We strictly require 'diff --git' because our parser depends on it for file identification
  if (!diff.startsWith('diff --git ')) {
    throw new DiffValidationError(text.diff.notUnifiedFormat);
  }

  const changedFiles = new Set<string>();
  let lineCount = 0;
  let currentFile: string | null = null;

  let pos = 0;
  let nextPos = 0;

  /**
   * Processes a single line of the diff to update metadata and check for violations.
   */
  const processLine = (line: string) => {
    if (!line) return;

    // 1. Handle File Headers (diff --git a/path b/path)
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match) {
        const aPath = match[1].replace(/\\/g, '/');
        const bPath = match[2].replace(/\\/g, '/');

        // Safety Check: No file creation, deletion, or renaming allowed
        if (aPath === 'dev/null') throw new DiffValidationError(text.diff.fileCreationNotAllowed(bPath));
        if (bPath === 'dev/null') throw new DiffValidationError(text.diff.fileDeletionNotAllowed(aPath));
        if (aPath !== bPath) throw new DiffValidationError(text.diff.fileRenameNotAllowed(aPath, bPath));

        currentFile = bPath;
        changedFiles.add(bPath);
      }
    } 
    // 2. Safety Check: Forbidden operation markers (extra layer of protection)
    else if (line.startsWith('new file mode ')) {
      throw new DiffValidationError(text.diff.fileCreationNotAllowed(currentFile || undefined));
    } else if (line.startsWith('deleted file mode ')) {
      throw new DiffValidationError(text.diff.fileDeletionNotAllowed(currentFile || undefined));
    } else if (line.startsWith('rename from ') || line.startsWith('rename to ')) {
      throw new DiffValidationError(text.diff.fileRenameNotAllowed());
    }
    // 3. Count Changed Lines (+ or - but not headers or markers)
    else if (
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---') &&
      !line.includes('\\ No newline at end of file')
    ) {
      lineCount++;
    }
  };

  // Efficient line-by-line iteration without creating a full array of lines
  while ((nextPos = diff.indexOf('\n', pos)) !== -1) {
    processLine(diff.substring(pos, nextPos));
    pos = nextPos + 1;
  }
  processLine(diff.substring(pos));

  const fileList = Array.from(changedFiles);
  const fileCount = fileList.length;

  // Final Validation against limits
  if (fileCount === 0) {
    throw new DiffValidationError(text.llm.patchEmpty('File count is 0'));
  }

  if (fileCount > limits.maxFilesChanged) {
    throw new DiffValidationError(text.diff.tooManyFiles(fileCount, limits.maxFilesChanged, fileList));
  }

  if (lineCount === 0) {
    throw new DiffValidationError(text.llm.patchEmpty('Line count is 0'));
  }

  if (lineCount > limits.maxDiffLines) {
    throw new DiffValidationError(text.diff.tooManyLines(lineCount, limits.maxDiffLines));
  }

  return {
    changedFiles: fileList,
    fileCount,
    lineCount,
  };
}
