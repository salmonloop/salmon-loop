import path from 'path';

/**
 * Normalize a path to use forward slashes, regardless of the operating system.
 * This ensures consistency across Windows and Linux/macOS.
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
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
