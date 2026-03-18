import path from 'path';

function isWindowsAbsolutePath(p: string): boolean {
  // Drive letter, e.g. "C:\\" or "C:/"
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  // UNC path, e.g. "\\\\server\\share"
  if (p.startsWith('\\\\')) return true;
  return false;
}

function shouldUseWin32PathSemantics(p: string): boolean {
  if (!p) return false;
  if (isWindowsAbsolutePath(p)) return true;
  // Heuristic: treat backslash-containing paths as Windows-like, even if relative.
  // This enables correct behavior for inputs like "src\\components\\file.ts" on POSIX.
  return p.includes('\\');
}

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
 * Normalize a path-like input into a stable repo-relative form.
 *
 * Intended for:
 * - Permission rules matching (stable normalization across platforms)
 * - Tool argument normalization and auditing
 *
 * This function does NOT validate safety (absolute/traversal); use isSafeRelativePath() or
 * sandbox resolution checks for security-sensitive operations.
 */
export function normalizeRepoRelativePath(input: string): string {
  return normalizePath(String(input ?? '').trim()).replace(/^(\.\/|\/)+/, '');
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
  const normalized = normalizePath(p);
  const impl = shouldUseWin32PathSemantics(p) ? path.win32 : path.posix;
  return normalizePath(impl.dirname(normalized));
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
  const normalizedRoot = normalizePath(root);
  const normalizedTarget = normalizePath(target);
  const impl = isWindowsAbsolutePath(normalizedRoot) ? path.win32 : path.posix;

  if (impl === path.posix && isWindowsAbsolutePath(normalizedTarget)) {
    throw new Error(`Security Violation: Path traversal attempt: ${target} is outside of ${root}`);
  }
  if (impl === path.win32 && normalizedTarget.startsWith('/')) {
    throw new Error(`Security Violation: Path traversal attempt: ${target} is outside of ${root}`);
  }

  const resolvedRoot = impl.resolve(normalizedRoot);
  const resolvedTarget = impl.resolve(normalizedTarget);

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

  const normalizedRoot = normalizePath(root);
  const normalizedTarget = normalizePath(target);
  const impl =
    isWindowsAbsolutePath(normalizedRoot) || shouldUseWin32PathSemantics(normalizedTarget)
      ? path.win32
      : path.posix;

  if (impl === path.posix && isWindowsAbsolutePath(normalizedTarget)) return false;
  if (impl === path.win32 && normalizedTarget.startsWith('/')) return false;

  const resolvedRoot = impl.resolve(normalizedRoot);
  const resolvedTarget = impl.resolve(normalizedTarget);
  const rel = impl.relative(resolvedRoot, resolvedTarget);
  const relNormalized = normalizePath(rel);

  if (relNormalized === '') return allowEqual;
  return !relNormalized.startsWith('..') && !impl.isAbsolute(rel);
}
