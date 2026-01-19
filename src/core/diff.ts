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
const cleanPath = (path: string) => {
  let normalized = path.replace(/\\/g, '/').replace(/^[a-zA-Z]:\//, '');

  // Only remove first dir if it has no file extension (likely repo name)
  // AND if it's not the only directory (to avoid breaking paths like src/index.js)
  const parts = normalized.split('/');
  if (parts.length > 1) {
    const firstDir = parts[0];
    const hasExtension = /\.(js|ts|json|md|txt|css|html|jsx|tsx|vue|py|rs|go|java|c|cpp|h)$/i.test(firstDir);

    // If the first part is a directory (no extension) and there are more parts,
    // it might be a repo name prefix added by LLM.
    // However, we should be careful not to strip legitimate source directories.
    // A better heuristic: if it's 'a/repo-name/path', we want 'path'.
    // But if it's 'a/src/index.js', we want 'src/index.js'.
    if (!hasExtension && parts.length > 1) {
      // Common source directories that we should NOT strip if they are at the top level
      const commonSrcDirs = ['src', 'lib', 'app', 'tests', 'test', 'packages'];
      if (!commonSrcDirs.includes(firstDir)) {
        normalized = parts.slice(1).join('/');
      }
    }
  }

  return normalized;
};

export function normalizeDiff(raw: string): string {
  const t = raw.trim();

  // 1. Extract the actual diff content from markdown or conversational text
  let content = t;
  const match = t.match(/```(?:diff)?\s*\n([\s\S]*?)\n```/i) || t.match(/(diff --git [\s\S]*)$/i);
  if (match) {
    content = match[1] || match[0];
  }

  // 2. Find where the actual diff starts (either 'diff --git' or '--- a/')
  const diffStart = content.search(/^(diff --git |--- a\/)/m);
  if (diffStart !== -1) {
    content = content.substring(diffStart);
  }

  // 3. Aggressively clean paths in the extracted content
  // This handles cases where LLM includes repo name like 'a/test-repo/index.js'
  // We use non-greedy matching and ensure we don't break the format
  const cleaned = content
    .replace(/^diff --git a\/(.+) b\/(.+)$/gm, (match, p1, p2) => {
      // Handle Windows paths by replacing backslashes and removing drive letters
      return `diff --git a/${cleanPath(p1)} b/${cleanPath(p2)}`;
    })
    .replace(/^--- a\/(.+)$/gm, (match, p1) => {
      return `--- a/${cleanPath(p1)}`;
    })
    .replace(/^\+\+\+ b\/(.+)$/gm, (match, p1) => {
      return `+++ b/${cleanPath(p1)}`;
    })
    .trimEnd() + '\n';

  return cleaned;
}

/**
 * Check if the text is a valid unified diff format.
 */
export function isUnifiedDiff(text: string): boolean {
  const d = normalizeDiff(text);
  return d.startsWith('diff --git ') || d.startsWith('--- a/');
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

  // We prefer 'diff --git' but can fallback to '--- a/' if needed
  if (!diff.startsWith('diff --git ') && !diff.startsWith('--- a/')) {
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
    } else if (line.startsWith('--- a/')) {
      const match = line.match(/^--- a\/(.+)$/);
      if (match) {
        const path = cleanPath(match[1]);
        currentFile = path;
        changedFiles.add(path);
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
