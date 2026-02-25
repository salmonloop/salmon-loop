import { existsSync } from 'fs';
import { join } from 'path';

function quoteShellArg(value: string): string {
  if (/^[a-zA-Z0-9_./:-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

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

export function buildBunCommand(args: string): string {
  return `${quoteShellArg(resolveBunExecutable())} ${args}`;
}
