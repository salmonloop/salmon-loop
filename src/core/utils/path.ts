import path from 'path';

/**
 * Normalize a path to use forward slashes, regardless of the operating system.
 * This ensures consistency across Windows and Linux/macOS.
 */
export function normalizePath(p: string): string {
  const replaced = p.replace(/\\/g, '/');
  // Collapse duplicate separators for repo-relative paths like "src\\index.js".
  // Preserve UNC-style prefix ("//server/share") by keeping the leading double slash.
  if (replaced.startsWith('//')) {
    return `//${replaced.slice(2).replace(/\/{2,}/g, '/')}`;
  }
  return replaced.replace(/\/{2,}/g, '/');
}

/**
 * Join path segments and normalize the result to use forward slashes.
 */
export function safeJoin(...paths: string[]): string {
  return normalizePath(path.join(...paths));
}

/**
 * Resolve path segments and normalize the result to use forward slashes.
 */
export function safeResolve(...paths: string[]): string {
  return normalizePath(path.resolve(...paths));
}

/**
 * Get the directory name of a path and normalize it.
 */
export function safeDirname(p: string): string {
  return normalizePath(path.dirname(p));
}

/**
 * Get the relative path from one path to another and normalize it.
 */
export function safeRelative(from: string, to: string): string {
  return normalizePath(path.relative(from, to));
}

/**
 * Check whether a path is a safe relative path (no absolute paths or traversal).
 */
export function isSafeRelativePath(p: string): boolean {
  const normalized = normalizePath(p);
  if (!normalized) return false;
  if (normalized.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(normalized)) return false;
  return !normalized.split('/').some((segment) => segment === '..');
}

/**
 * Ensures a path is safely contained within a root directory.
 * Throws a security violation if the path escapes the sandbox.
 */
export function ensureInSandbox(root: string, target: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);

  if (!isPathWithinDirectory(resolvedRoot, resolvedTarget, { allowEqual: true })) {
    throw new Error(`Security Violation: Path traversal attempt: ${target} is outside of ${root}`);
  }

  return normalizePath(resolvedTarget);
}

/**
 * Check whether a target path is located within a root directory.
 * Uses resolved absolute paths and path.relative to avoid prefix-match pitfalls.
 */
export function isPathWithinDirectory(
  root: string,
  target: string,
  options: { allowEqual?: boolean } = {},
): boolean {
  const { allowEqual = true } = options;
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const rel = path.relative(resolvedRoot, resolvedTarget);

  if (rel === '') return allowEqual;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}
