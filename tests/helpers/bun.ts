import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Resolves the bun executable path.
 * Returns the raw path without quoting to avoid shell escaping issues.
 */
export function resolveBunExecutable(): string {
  const explicit = (process.env.BUN_BINARY || '').trim();
  if (explicit) return explicit;

  // When running via `bun test`, process.execPath points to the Bun binary.
  if (process.execPath && /(^|\/|\\)bun(\.exe)?$/i.test(process.execPath)) {
    return process.execPath;
  }

  const home = process.env.HOME;
  if (home) {
    const candidate = join(home, '.bun', 'bin', 'bun');
    if (existsSync(candidate)) return candidate;
  }

  return 'bun';
}

/**
 * Builds a bun command string for execution.
 * Does not add extra quoting - relies on shell to handle argument escaping.
 */
export function buildBunCommand(args: string): string {
  const exe = resolveBunExecutable();
  return `${exe} ${args}`;
}
